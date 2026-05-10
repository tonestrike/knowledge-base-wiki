import { lintRunId, wikiId } from '@package/contracts/shared';
import { LintEvent } from '@package/contracts/verification';
import { lintWiki } from '../../application/lint-wiki.ts';
import type { LintRuntimeDeps } from '../../application/ports.ts';
import { LintRun } from '../../domain/lint-run.ts';

// Minimal Durable Object surface — defined locally to keep
// @cloudflare/workers-types out of this package's dependency graph.
export interface DurableObjectState {
  storage: DurableObjectStorage;
  waitUntil(promise: Promise<unknown>): void;
}
export interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
}

const TAPE_KEY = 'tape';

export interface LintRunDOFactoryArgs<Env> {
  buildDeps: (env: Env, emit: (e: LintEvent) => Promise<void>) => LintRuntimeDeps;
}

interface StartCommand {
  kind: 'start';
  lintRunId: string;
  wikiId: string;
}

// Per-LintRun Durable Object. Holds an event tape in storage so reconnecting
// SSE subscribers replay the run from the start, and runs the lintWiki
// orchestrator inside state.waitUntil so the start request returns 202
// immediately.
export const createLintRunDOClass = <Env>({ buildDeps }: LintRunDOFactoryArgs<Env>) =>
  class LintRunDO {
    private readonly state: DurableObjectState;
    private readonly env: Env;
    private readonly subscribers = new Set<(e: LintEvent) => void>();

    constructor(state: DurableObjectState, env: Env) {
      this.state = state;
      this.env = env;
    }

    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === '/start' && request.method === 'POST') {
        const cmd = (await request.json()) as StartCommand;
        if (cmd?.kind !== 'start') {
          return new Response('bad request', { status: 400 });
        }
        this.state.waitUntil(this.run(cmd));
        return new Response('ok', { status: 202 });
      }
      if (url.pathname === '/subscribe' && request.method === 'GET') {
        return this.subscribe();
      }
      return new Response('not found', { status: 404 });
    }

    private subscribe(): Response {
      const subscribers = this.subscribers;
      const storage = this.state.storage;
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder();
          const send = (e: LintEvent) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
          };
          subscribers.add(send);
          // Replay the persisted tape (if any) before live events.
          // Awaited so a storage rejection surfaces as a stream error to the
          // SSE consumer instead of being silently dropped (see PR #6
          // silent-failure-hunter finding 2).
          try {
            const tape = await storage.get<LintEvent[]>(TAPE_KEY);
            for (const e of tape ?? []) send(e);
          } catch (err) {
            controller.error(err);
            subscribers.delete(send);
          }
        },
        cancel() {
          // Note: each subscriber owns its own `send` closure; we cannot
          // identify which one to remove from here. Detached subscribers are
          // pruned in the emit() send loop on the next event when their
          // `controller.enqueue` throws.
        },
      });
      return new Response(stream, {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'x-accel-buffering': 'no',
        },
      });
    }

    private async run(cmd: StartCommand) {
      const tape: LintEvent[] = [];
      const subscribers = this.subscribers;
      const storage = this.state.storage;
      const emit = async (raw: LintEvent) => {
        const e = LintEvent.parse(raw);
        tape.push(e);
        await storage.put(TAPE_KEY, tape);
        // Iterate a snapshot so deletions during iteration are safe.
        for (const send of [...subscribers]) {
          try {
            send(e);
          } catch (err) {
            // The most common cause is a detached subscriber whose stream
            // controller has closed — drop them from the set so the Set
            // doesn't grow without bound (see PR #6 silent-failure-hunter
            // finding 4). Any other error is surfaced to console so it does
            // not vanish.
            subscribers.delete(send);
            const msg = err instanceof Error ? err.message : String(err);
            if (!/detached|closed|invalid state/i.test(msg)) {
              console.error('[LintRunDO] subscriber send failed', err);
            }
          }
        }
      };
      const deps = buildDeps(this.env, emit);
      const id = lintRunId(cmd.lintRunId);
      try {
        await lintWiki(deps, { lintRunId: id, wikiId: wikiId(cmd.wikiId) });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Keep the persisted LintRun in sync with the LintRunFailed event.
        // If there is no row yet (e.g. listClaimsForWiki rejected before
        // insert) the update is a no-op against the repo's WHERE id=? — that
        // is acceptable; the SSE tape still records the failure.
        const existing = await deps.runs.findById(id);
        if (existing && (existing.status === 'pending' || existing.status === 'running')) {
          const failed = LintRun.fail(existing, message, deps.now().toISOString());
          await deps.runs.update(failed);
        }
        await emit({
          kind: 'LintRunFailed',
          lintRunId: id,
          message,
        });
      }
    }
  };
