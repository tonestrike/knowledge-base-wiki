import type { CompileRunId, FolderId } from '@package/contracts/shared';
import type { CompileEvent } from '@package/contracts/wiki';
import { compileFolder } from '../../application/compile-folder.ts';
import type { CompileRuntimeDeps } from '../../application/ports.ts';
import type { DurableObjectState } from '../cf-types.ts';

interface RunCommand {
  kind: 'start';
  compileRunId: string;
  folderId: string;
}

const TAPE_KEY = 'tape';
const STATUS_KEY = 'status';

// SF4 — three-state status discriminator. 'failed' is retryable through
// /start; 'finished' is terminal-success and 'running' is in-flight.
type DoStatus = 'running' | 'finished' | 'failed';

// SF7 — every event on the tape carries a monotonic sequence number so the
// dispatcher (or any subscriber) can dedupe events that arrive both via
// replay and the live stream.
interface SequencedEvent {
  seq: number;
  event: CompileEvent;
}

// Factory pattern: the DO class is parameterized by a `buildDeps` function so
// the same class can be wired by `apps/api` with real CF bindings or by tests
// with stubs. Cloudflare requires a class export; we hand the result of
// `createCompileRunDOClass` to `apps/api/src/durable-objects.ts`, which then
// re-exports it as `CompileRunDO`.

export interface CompileRunDOFactoryArgs<Env> {
  buildDeps: (env: Env, emit: (e: CompileEvent) => Promise<void>) => CompileRuntimeDeps;
}

export const createCompileRunDOClass = <Env extends Record<string, unknown>>({
  buildDeps,
}: CompileRunDOFactoryArgs<Env>) => {
  return class CompileRunDO {
    // Subscribers receive sequenced events. Closure of a subscriber on send
    // is detected per-iteration and the subscriber is removed from the set.
    private subscribers = new Set<(e: SequencedEvent) => void>();

    constructor(
      private readonly state: DurableObjectState,
      private readonly env: Env,
    ) {}

    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);

      if (url.pathname === '/start' && req.method === 'POST') {
        const cmd = (await req.json()) as RunCommand;
        const status = await this.state.storage.get<DoStatus>(STATUS_KEY);
        // SF4 — idempotency: don't kick off twice for an in-flight or
        // successfully-finished run, but DO allow a retry from a 'failed'
        // status. Re-subscribers should call /subscribe instead of /start.
        if (status === 'running' || status === 'finished') {
          return new Response('already-running', { status: 202 });
        }
        // Retry path: clear the previous run's tape so the new attempt
        // doesn't replay stale events to subscribers.
        if (status === 'failed') {
          await this.state.storage.put(TAPE_KEY, [] as SequencedEvent[]);
        }
        await this.state.storage.put(STATUS_KEY, 'running' as DoStatus);
        this.state.waitUntil(this.run(cmd));
        return new Response('started', { status: 202 });
      }

      if (url.pathname === '/subscribe' && req.method === 'GET') {
        // SF7 — replay BEFORE registering the live subscriber. Otherwise
        // events emitted between "register" and "replay" can interleave
        // and arrive twice / out of order. We hold a per-subscriber send
        // closure and only push it into `this.subscribers` after the tape
        // has finished replaying.
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
                // Replay aborted — controller is closed; nothing further
                // to do. We never registered as a live subscriber so no
                // cleanup is needed.
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
            // SF13 — actually unregister; previous version was a no-op,
            // letting closed subscribers accumulate in the Set forever.
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

    private async run(cmd: RunCommand): Promise<void> {
      const tape: SequencedEvent[] =
        (await this.state.storage.get<SequencedEvent[]>(TAPE_KEY)) ?? [];
      let nextSeq = tape.length > 0 ? (tape[tape.length - 1]?.seq ?? 0) + 1 : 1;

      const emit = async (event: CompileEvent) => {
        const sequenced: SequencedEvent = { seq: nextSeq++, event };
        tape.push(sequenced);
        await this.state.storage.put(TAPE_KEY, tape);
        // SF6 — snapshot subscribers before iteration; mutating the Set
        // mid-iteration loses entries silently. Failed sends remove that
        // specific subscriber so a single misbehaving consumer cannot
        // wedge the loop forever.
        const snapshot = [...this.subscribers];
        for (const s of snapshot) {
          try {
            s(sequenced);
          } catch (sErr) {
            this.subscribers.delete(s);
            // Best-effort log so production debugging has a hook; the
            // tape is durable so any new subscriber will replay missed
            // events.
            console.warn('[CompileRunDO] subscriber send failed; removed', sErr);
          }
        }
      };

      const deps = buildDeps(this.env, emit);
      try {
        await compileFolder(deps, {
          compileRunId: cmd.compileRunId as CompileRunId,
          folderId: cmd.folderId as FolderId,
        });
        await this.state.storage.put(STATUS_KEY, 'finished' as DoStatus);
      } catch (err) {
        // SF4 — distinguish failure from success. compileFolder already
        // emitted CompileFailed on the tape before re-throwing; we record
        // 'failed' so /start can be retried by the user.
        console.error('[CompileRunDO] compileFolder failed:', err);
        await this.state.storage.put(STATUS_KEY, 'failed' as DoStatus);
      }
    }
  };
};
