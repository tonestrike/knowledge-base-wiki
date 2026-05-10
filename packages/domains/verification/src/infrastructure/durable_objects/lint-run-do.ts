import { lintRunId, wikiId } from '@package/contracts/shared';
import { LintEvent } from '@package/contracts/verification';
import { lintWiki } from '../../application/lint-wiki.ts';
import type { LintRuntimeDeps } from '../../application/ports.ts';

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
      const stream = new ReadableStream<Uint8Array>({
        start: (controller) => {
          const encoder = new TextEncoder();
          const send = (e: LintEvent) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
          };
          this.subscribers.add(send);
          // Replay the persisted tape (if any) before live events.
          this.state.storage.get<LintEvent[]>(TAPE_KEY).then((tape) => {
            for (const e of tape ?? []) send(e);
          });
        },
        cancel: () => {
          // best-effort: clear all senders on cancel; in practice each
          // subscriber gets its own controller closure.
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
      const emit = async (raw: LintEvent) => {
        const e = LintEvent.parse(raw);
        tape.push(e);
        await this.state.storage.put(TAPE_KEY, tape);
        for (const send of this.subscribers) {
          try {
            send(e);
          } catch {
            // detached subscriber; let GC clean up
          }
        }
      };
      const deps = buildDeps(this.env, emit);
      try {
        await lintWiki(deps, {
          lintRunId: lintRunId(cmd.lintRunId),
          wikiId: wikiId(cmd.wikiId),
        });
      } catch (err) {
        await emit({
          kind: 'LintRunFailed',
          lintRunId: lintRunId(cmd.lintRunId),
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  };
