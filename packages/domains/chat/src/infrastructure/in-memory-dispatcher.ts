import type { AnswerEvent } from '@package/contracts/chat';
import type { ConversationId, TurnId, WikiId } from '@package/contracts/shared';
import type { EventBus } from '@package/shared-kernel';
import type {
  ConversationDispatcher,
  ConversationRepository,
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

const errorId = (): string => {
  const r =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return r.slice(0, 8);
};

/**
 * An in-process implementation of `ConversationDispatcher` for dev, tests,
 * and the contract-mock end of the demo. Production binds the same port to
 * a Cloudflare Durable Object that hosts one Conversation. The semantics
 * match: `start` schedules the run; `subscribe` yields the live tape and
 * replays the buffered prefix so a late subscriber catches up.
 *
 * Consistency model (SF-CHAT-3, mirrors PR #6 verification.applyCorrection):
 * On AnswerFinished we publish `AnswerProduced` BEFORE the final `Turn.finish`
 * persist. Failure modes:
 *   - publish fails → outer catch surfaces AnswerFailed; persist never runs.
 *     Retry is safe (the run is fire-and-forget; the dispatcher only handles
 *     one Turn id once, but consumers are idempotent on `turnId`).
 *   - publish succeeds, persist fails → outer catch surfaces AnswerFailed.
 *     The wiki-side `AnswerProduced` handler MUST be idempotent on the
 *     `(conversationId, turnId)` key so a future re-publish (in a transactional
 *     outbox phase 3) is harmless.
 *
 * The transactional-outbox pattern (publish row + finish in one D1 batch,
 * drained by a relayer) is deferred — tracked under
 * /docs/projects/0002-folder-wiki.md alongside the eventBus production
 * hardening that PR #7 coordinates.
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
      // Emit AnswerStarted + ResearchStarted up front so the UI can flip
      // into the "Researcher running" state immediately (the LLM call
      // below blocks for several seconds — without these the user sees a
      // blank chat with no progress).
      emit(key, { kind: 'AnswerStarted', turnId: args.turnId });
      emit(key, {
        kind: 'ResearchStarted',
        turnId: args.turnId,
        model: 'anthropic/claude-sonnet-4.6',
      });

      const { findings, pages } = await researchQuestion(deps, {
        wikiId: args.wikiId,
        question: args.question,
      });

      emit(key, {
        kind: 'ResearchCompleted',
        turnId: args.turnId,
        candidatePageCount: pages.length,
        findingCount: findings.length,
      });

      // SF-CHAT-2: if the Turn vanished between `ask` insert and dispatcher
      // pickup that's a programmer error, not a recoverable state. Fail loud
      // — the outer catch reshapes it into AnswerFailed for the caller.
      const turn = await deps.turns.findById(args.turnId);
      if (!turn) {
        throw new Error(
          `Turn not found in dispatcher run: ${args.turnId} (conversationId=${args.conversationId})`,
        );
      }

      emit(key, {
        kind: 'SynthesisStarted',
        turnId: args.turnId,
        model: 'anthropic/claude-sonnet-4.6',
      });

      let working: Turn = turn;
      for await (const evt of synthesizeAnswer(
        { synthesizer: deps.synthesizer, sourceHashes: deps.sourceHashes },
        { turnId: args.turnId, question: args.question, findings },
      )) {
        // Skip the use-case's own AnswerStarted — we already fired one
        // before research kicked off.
        if (evt.kind === 'AnswerStarted') continue;
        emit(key, evt);
        if (evt.kind === 'AnswerSegment') {
          working = Turn.appendSegment(working, evt.segment);
          await deps.turns.update(working);
        }
        if (evt.kind === 'AnswerFinished') {
          // Publish-then-persist (see consistency-model comment above).
          await deps.eventBus.publish({
            name: 'AnswerProduced',
            occurredAt: deps.now().toISOString(),
            payload: {
              conversationId: args.conversationId,
              turnId: args.turnId,
              wikiId: args.wikiId,
            },
          });
          working = Turn.finish(working, deps.now().toISOString());
          await deps.turns.update(working);
        }
      }
    } catch (err) {
      const id = errorId();
      console.error('[chat.in-memory-dispatcher] run failed', {
        errorId: id,
        conversationId: args.conversationId,
        turnId: args.turnId,
        wikiId: args.wikiId,
        err:
          err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
      });
      emit(key, {
        kind: 'AnswerFailed',
        turnId: args.turnId,
        message: `Dispatcher run failed (errorId=${id}, turnId=${args.turnId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  };

  return {
    async start(args) {
      const key = subscribeKey(args.conversationId, args.turnId);
      tapeFor(key);
      // Fire-and-forget; the live stream pushes through `emit`. SF-CHAT-10:
      // attach a top-level catch so a synchronous throw in `run` (before its
      // own try/catch) still surfaces as AnswerFailed instead of an
      // unhandled-rejection log.
      void run(args).catch((err) => {
        const id = errorId();
        console.error('[chat.in-memory-dispatcher] run threw synchronously', {
          errorId: id,
          turnId: args.turnId,
          err:
            err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
        });
        emit(key, {
          kind: 'AnswerFailed',
          turnId: args.turnId,
          message: `Dispatcher start failed (errorId=${id}, turnId=${args.turnId}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      });
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
