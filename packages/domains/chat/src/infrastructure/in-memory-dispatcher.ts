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
import { runChatTurn } from '../application/run-chat-turn.ts';

export interface InMemoryDispatcherDeps {
  researcher: Researcher;
  synthesizer: Synthesizer;
  sourceHashes: SourceHashVerifier;
  conversations: ConversationRepository;
  turns: TurnRepository;
  eventBus: EventBus;
  wikiReader: import('../application/ports.ts').WikiReader;
  now: () => Date;
  /**
   * Optional human-readable label for the wired Researcher implementation,
   * surfaced in `ResearchStarted.model`. Lets the chat dock distinguish
   * "agent-loop" (the agentic researcher) from "wiki-search" (the direct
   * fallback) without inferring from event timing.
   */
  researcherName?: string;
  /** Optional override surfaced in `SynthesisStarted.model`. */
  synthesizerName?: string;
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
    await runChatTurn(deps, args, (e) => {
      emit(key, e);
    });
  };

  return {
    async start(args) {
      const key = subscribeKey(args.conversationId, args.turnId);
      tapeFor(key);
      // The live stream pushes through `emit`. SF-CHAT-10: attach a top-level
      // catch so a synchronous throw in `run` (before its own try/catch)
      // still surfaces as AnswerFailed instead of an unhandled-rejection log.
      //
      // SF-CHAT-11 (Workers keepalive): `chat.ask` returns synchronously with
      // the turnId; the SSE `streamAnswer` subscription is a separate HTTP
      // request. Without `args.waitUntil` (= `ExecutionContext.waitUntil`),
      // workerd treats the `run` promise as orphaned once `ask` responds and
      // refuses any new I/O it tries to perform — the first `await` on D1 in
      // `researchQuestion` hangs forever. Anchoring `runPromise` to
      // `waitUntil` keeps the isolate scheduling I/O until the run resolves.
      const runPromise = run(args).catch((err) => {
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
      if (args.waitUntil) args.waitUntil(runPromise);
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
