import type { AnswerEvent } from '@package/contracts/chat';
import type { AnswerProduced } from '@package/contracts/events';
import type { ConversationId, TurnId, WikiId } from '@package/contracts/shared';
import type {
  ConversationDispatcher,
  ConversationRepository,
  EventBus,
  Researcher,
  SourceHashVerifier,
  Synthesizer,
  TurnRepository,
} from '../application/ports.ts';
import { researchQuestion } from '../application/research-question.ts';
import { synthesizeAnswer } from '../application/synthesize-answer.ts';
import { Turn } from '../domain/turn.ts';

export interface InMemoryDispatcherDeps {
  researcher: Researcher;
  synthesizer: Synthesizer;
  sourceHashes: SourceHashVerifier;
  conversations: ConversationRepository;
  turns: TurnRepository;
  eventBus: EventBus;
  wikiReader: import('../application/ports.ts').WikiReader;
  now: () => Date;
}

interface Subscription {
  push(e: AnswerEvent): void;
  close(): void;
}

interface Tape {
  events: AnswerEvent[];
  done: boolean;
  subs: Set<Subscription>;
}

const subscribeKey = (conversationId: string, turnId: string) => `${conversationId}:${turnId}`;

/**
 * An in-process implementation of `ConversationDispatcher` for dev, tests,
 * and the contract-mock end of the demo. Production binds the same port to
 * a Cloudflare Durable Object that hosts one Conversation. The semantics
 * match: `start` schedules the run; `subscribe` yields the live tape and
 * replays the buffered prefix so a late subscriber catches up.
 */
export const createInMemoryDispatcher = (deps: InMemoryDispatcherDeps): ConversationDispatcher => {
  const tapes = new Map<string, Tape>();

  const tapeFor = (key: string): Tape => {
    let t = tapes.get(key);
    if (!t) {
      t = { events: [], done: false, subs: new Set() };
      tapes.set(key, t);
    }
    return t;
  };

  const emit = (key: string, e: AnswerEvent): void => {
    const t = tapeFor(key);
    t.events.push(e);
    for (const sub of t.subs) sub.push(e);
    if (e.kind === 'AnswerFinished' || e.kind === 'AnswerFailed') {
      t.done = true;
      for (const sub of t.subs) sub.close();
      t.subs.clear();
    }
  };

  const run = async (args: {
    conversationId: ConversationId;
    turnId: TurnId;
    wikiId: WikiId;
    question: string;
  }): Promise<void> => {
    const key = subscribeKey(args.conversationId, args.turnId);
    try {
      const { findings } = await researchQuestion(deps, {
        wikiId: args.wikiId,
        question: args.question,
      });

      const turn = await deps.turns.findById(args.turnId);
      let working = turn;
      for await (const evt of synthesizeAnswer(
        { synthesizer: deps.synthesizer, sourceHashes: deps.sourceHashes },
        { turnId: args.turnId, question: args.question, findings },
      )) {
        emit(key, evt);
        if (working && evt.kind === 'AnswerSegment') {
          working = Turn.appendSegment(working, evt.segment);
          await deps.turns.update(working);
        }
        if (working && evt.kind === 'AnswerFinished') {
          working = Turn.finish(working, deps.now().toISOString());
          await deps.turns.update(working);
          const produced: AnswerProduced = {
            name: 'AnswerProduced',
            occurredAt: deps.now().toISOString(),
            payload: {
              conversationId: args.conversationId,
              turnId: args.turnId,
              wikiId: args.wikiId,
            },
          };
          await deps.eventBus.publish(produced);
        }
      }
    } catch (err) {
      emit(key, {
        kind: 'AnswerFailed',
        turnId: args.turnId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return {
    async start(args) {
      const key = subscribeKey(args.conversationId, args.turnId);
      tapeFor(key);
      // Fire-and-forget; the live stream pushes through `emit`.
      void run(args);
    },
    subscribe({ conversationId, turnId }) {
      const key = subscribeKey(conversationId, turnId);
      const t = tapeFor(key);
      const buffered: AnswerEvent[] = [...t.events];
      let resolveNext: ((value: IteratorResult<AnswerEvent>) => void) | null = null;
      const queue: AnswerEvent[] = [];
      let closed = t.done;

      const sub: Subscription = {
        push(e) {
          if (resolveNext) {
            const r = resolveNext;
            resolveNext = null;
            r({ value: e, done: false });
          } else {
            queue.push(e);
          }
        },
        close() {
          closed = true;
          if (resolveNext) {
            const r = resolveNext;
            resolveNext = null;
            r({ value: undefined as unknown as AnswerEvent, done: true });
          }
        },
      };
      if (!t.done) t.subs.add(sub);

      return {
        [Symbol.asyncIterator](): AsyncIterator<AnswerEvent> {
          return {
            async next(): Promise<IteratorResult<AnswerEvent>> {
              const head = buffered.shift();
              if (head !== undefined) {
                return { value: head, done: false };
              }
              const queued = queue.shift();
              if (queued !== undefined) {
                return { value: queued, done: false };
              }
              if (closed) return { value: undefined as unknown as AnswerEvent, done: true };
              return new Promise<IteratorResult<AnswerEvent>>((resolve) => {
                resolveNext = resolve;
              });
            },
            async return(): Promise<IteratorResult<AnswerEvent>> {
              t.subs.delete(sub);
              closed = true;
              return { value: undefined as unknown as AnswerEvent, done: true };
            },
          };
        },
      };
    },
  };
};
