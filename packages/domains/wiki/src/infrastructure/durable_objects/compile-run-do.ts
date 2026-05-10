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
    private subscribers = new Set<(e: CompileEvent) => void>();
    private closedSubscribers = new Set<(e: CompileEvent) => void>();

    constructor(
      private readonly state: DurableObjectState,
      private readonly env: Env,
    ) {}

    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);

      if (url.pathname === '/start' && req.method === 'POST') {
        const cmd = (await req.json()) as RunCommand;
        const status = await this.state.storage.get<string>(STATUS_KEY);
        // Idempotency: don't kick off twice for the same DO id. Re-subscribers
        // should call /subscribe instead of /start.
        if (status === 'running' || status === 'finished') {
          return new Response('already-running', { status: 202 });
        }
        await this.state.storage.put(STATUS_KEY, 'running');
        this.state.waitUntil(this.run(cmd));
        return new Response('started', { status: 202 });
      }

      if (url.pathname === '/subscribe' && req.method === 'GET') {
        const stream = new ReadableStream<Uint8Array>({
          start: async (controller) => {
            const enc = new TextEncoder();
            const send = (e: CompileEvent) => {
              try {
                controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
              } catch {
                // Controller closed by the consumer mid-flight.
                this.subscribers.delete(send);
                this.closedSubscribers.add(send);
              }
            };
            this.subscribers.add(send);
            // Replay tape so late subscribers see history.
            const tape = (await this.state.storage.get<CompileEvent[]>(TAPE_KEY)) ?? [];
            for (const e of tape) send(e);
            // If the run already ended, close the stream.
            const status = await this.state.storage.get<string>(STATUS_KEY);
            if (status === 'finished') {
              this.subscribers.delete(send);
              try {
                controller.close();
              } catch {
                // already closed
              }
            }
          },
          cancel: () => {
            // Subscribers prune themselves on the next emit; nothing to do.
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
      const tape: CompileEvent[] = (await this.state.storage.get<CompileEvent[]>(TAPE_KEY)) ?? [];

      const emit = async (e: CompileEvent) => {
        tape.push(e);
        await this.state.storage.put(TAPE_KEY, tape);
        for (const s of this.subscribers) {
          try {
            s(e);
          } catch {
            // Drop misbehaving subscribers silently; the tape is the source of
            // truth and any new subscriber will replay it.
            this.subscribers.delete(s);
          }
        }
      };

      const deps = buildDeps(this.env, emit);
      try {
        await compileFolder(deps, {
          compileRunId: cmd.compileRunId as CompileRunId,
          folderId: cmd.folderId as FolderId,
        });
      } catch (err) {
        // compileFolder already emits CompileFailed before re-throwing; we
        // swallow here so the DO doesn't crash mid-stream.
        console.error('[CompileRunDO] compileFolder failed:', err);
      } finally {
        await this.state.storage.put(STATUS_KEY, 'finished');
      }
    }
  };
};
