import type { AnswerEvent } from '@package/contracts/chat';
import type { ConversationId, TurnId, WikiId } from '@package/contracts/shared';
import {
  type RunChatTurnArgs,
  type RunChatTurnDeps,
  runChatTurn,
} from '../../application/run-chat-turn.ts';
import type { DurableObjectState } from '../cf-types.ts';

interface StartCommand {
  kind: 'start';
  conversationId: string;
  turnId: string;
  wikiId: string;
  question: string;
}

const TAPE_KEY = 'tape';
const STATUS_KEY = 'status';

// Mirrors the wiki CompileRunDO three-state machine. 'failed' is retryable
// through /start; 'finished' is terminal-success; 'running' is in-flight.
type DoStatus = 'running' | 'finished' | 'failed';

// Every event on the tape carries a monotonic sequence number so the
// dispatcher (or any subscriber) can dedupe events that arrive both via
// replay and the live stream.
interface SequencedEvent {
  seq: number;
  event: AnswerEvent;
}

// Factory pattern: the DO class is parameterized by a `buildDeps` function
// so the same class can be wired by `apps/api` with real CF bindings or by
// tests with stubs. Cloudflare requires a class export; we hand the result
// of `createChatTurnDOClass` to `apps/api/src/durable-objects.ts`, which
// re-exports it as `ChatTurnDO`.

export interface ChatTurnDOFactoryArgs<Env> {
  buildDeps: (env: Env) => RunChatTurnDeps;
}

/**
 * # ChatTurnDO — the per-turn Durable Object
 *
 * Hosts one chat turn's research + synth loop. Required for prod on
 * Cloudflare Workers because:
 *
 *   - `chat.ask` and `chat.streamAnswer` are two HTTP requests
 *   - Workers route each request to an arbitrary isolate
 *   - The per-turn event tape needs to be visible to both
 *
 * Without the DO, the in-memory dispatcher's `Map<turnId, Tape>`
 * silently falls out of sync across isolates and the SSE consumer
 * waits forever on an empty tape. The DO gives both requests a
 * single addressable home keyed by `${conversationId}:${turnId}`.
 *
 * ## Two endpoints
 *
 *   - `POST /start` with `{ conversationId, turnId, wikiId, question }`
 *     starts the run, anchored via `state.waitUntil` so it outlives
 *     the fetch response. Idempotent: re-/start on an in-flight or
 *     finished turn returns 202 without re-running.
 *
 *   - `GET /subscribe` opens an SSE stream. Replays the durable tape
 *     first, then registers a live subscriber for new events. Frames
 *     are `data: { seq, event }\n\n`; the dispatcher client dedupes
 *     on `seq`. If the run already terminated when /subscribe is
 *     called, replay + close (which is the late-subscriber path that
 *     keeps refresh-after-finish working).
 *
 * ## Status state machine
 *
 *     undefined → 'running' → 'finished' | 'failed'
 *
 * Retry path: a 'failed' run can be /start-ed again; we clear the
 * tape first so subscribers don't replay stale events from the
 * previous attempt. Mirrors the wiki's CompileRunDO.
 *
 * ## Factory pattern
 *
 * Cloudflare requires the DO class to be exported by name from the
 * Worker's entrypoint. We expose `createChatTurnDOClass({ buildDeps })`
 * so apps/api can wire the class with real bindings while tests can
 * wire it with stubs.
 */
export const createChatTurnDOClass = <Env extends Record<string, unknown>>({
  buildDeps,
}: ChatTurnDOFactoryArgs<Env>) => {
  return class ChatTurnDO {
    private subscribers = new Set<(e: SequencedEvent) => void>();

    constructor(
      private readonly state: DurableObjectState,
      private readonly env: Env,
    ) {}

    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);

      if (url.pathname === '/start' && req.method === 'POST') {
        const cmd = (await req.json()) as StartCommand;
        const status = await this.state.storage.get<DoStatus>(STATUS_KEY);
        if (status === 'running' || status === 'finished') {
          return new Response('already-running', { status: 202 });
        }
        // Retry path: clear the previous run's tape so a new attempt
        // doesn't replay stale events to subscribers.
        if (status === 'failed') {
          await this.state.storage.put(TAPE_KEY, [] as SequencedEvent[]);
        }
        await this.state.storage.put(STATUS_KEY, 'running' as DoStatus);
        this.state.waitUntil(
          this.run({
            conversationId: cmd.conversationId as ConversationId,
            turnId: cmd.turnId as TurnId,
            wikiId: cmd.wikiId as WikiId,
            question: cmd.question,
          }),
        );
        return new Response('started', { status: 202 });
      }

      if (url.pathname === '/subscribe' && req.method === 'GET') {
        let send: ((e: SequencedEvent) => void) | null = null;
        const stream = new ReadableStream<Uint8Array>({
          start: async (controller) => {
            const enc = new TextEncoder();
            send = (e) => {
              // Throws when the consumer closed the controller mid-flight.
              // The run() loop's snapshot iteration catches the throw and
              // removes `send` from the subscribers Set.
              controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
            };
            const tape = (await this.state.storage.get<SequencedEvent[]>(TAPE_KEY)) ?? [];
            for (const e of tape) {
              try {
                send(e);
              } catch {
                // Replay aborted — controller is closed.
                return;
              }
            }
            this.subscribers.add(send);
            // If the run already terminated, close the stream — the tape
            // we just replayed is the full event history.
            const status = await this.state.storage.get<DoStatus>(STATUS_KEY);
            if (status === 'finished' || status === 'failed') {
              this.subscribers.delete(send);
              try {
                controller.close();
              } catch {
                // already closed
              }
            }
          },
          cancel: () => {
            if (send) this.subscribers.delete(send);
          },
        });
        return new Response(stream, {
          headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
          },
        });
      }

      return new Response('not found', { status: 404 });
    }

    // Called by /start (via state.waitUntil). Spins up runChatTurn
    // with an `emit` closure that does two things for every event the
    // runner produces:
    //   1. Sequences the event and persists it to the DO's durable
    //      tape (so late /subscribe callers can replay)
    //   2. Fan-outs to every live SSE subscriber registered on
    //      this.subscribers
    //
    // runChatTurn is the same loop the in-memory dispatcher uses (see
    // packages/domains/chat/src/application/run-chat-turn.ts) — this
    // DO just wraps it with sequencing + durability.
    private async run(args: RunChatTurnArgs): Promise<void> {
      const tape: SequencedEvent[] =
        (await this.state.storage.get<SequencedEvent[]>(TAPE_KEY)) ?? [];
      let nextSeq = tape.length > 0 ? (tape[tape.length - 1]?.seq ?? 0) + 1 : 1;

      // The emit callback passed into runChatTurn. Every AnswerEvent
      // the runner produces (AnswerStarted, WikiPageRetrieved,
      // AnswerProseDelta, …) flows through here. Order matters: the
      // tape is the durable source of truth so we write to storage
      // BEFORE we notify subscribers.
      const emit = async (event: AnswerEvent): Promise<void> => {
        const sequenced: SequencedEvent = { seq: nextSeq++, event };
        tape.push(sequenced);
        await this.state.storage.put(TAPE_KEY, tape);
        // Snapshot subscribers before iteration; mutating the Set
        // mid-iteration loses entries silently. Failed sends drop only
        // that subscriber so a single misbehaving consumer cannot wedge
        // the loop forever. New /subscribe arrivals catch up via the
        // tape replay in fetch() above.
        const snapshot = [...this.subscribers];
        for (const s of snapshot) {
          try {
            s(sequenced);
          } catch (sErr) {
            this.subscribers.delete(s);
            console.warn('[ChatTurnDO] subscriber send failed; removed', sErr);
          }
        }
      };

      const deps = buildDeps(this.env);
      try {
        await runChatTurn(deps, args, emit);
        // runChatTurn handles its own errors and always emits a terminal
        // AnswerFinished / AnswerFailed before returning. We mark status
        // by reading the last sequenced event off the tape.
        const last = tape[tape.length - 1];
        const terminal = last?.event.kind === 'AnswerFailed' ? 'failed' : 'finished';
        await this.state.storage.put(STATUS_KEY, terminal as DoStatus);
      } catch (err) {
        // Defense in depth: runChatTurn shouldn't throw, but if it does
        // (a bug, or a thrown-not-rejected from emit) we still mark the
        // run as failed so /start can be retried.
        console.error('[ChatTurnDO] runChatTurn threw:', err);
        await this.state.storage.put(STATUS_KEY, 'failed' as DoStatus);
      } finally {
        // Close any live subscribers so they don't hang. The tape is
        // durable — a new /subscribe call will replay the full run.
        const snapshot = [...this.subscribers];
        this.subscribers.clear();
        for (const _s of snapshot) {
          // No `close()` on our send closure; the SSE controller's
          // natural lifecycle ends when the response stream is unwound.
          // The dispatcher client treats a terminal AnswerFinished /
          // AnswerFailed event as the end-of-iteration signal, so the
          // empty-subscriber state here is effectively the same.
        }
      }
    }
  };
};
