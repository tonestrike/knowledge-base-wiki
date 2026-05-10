import { CompileEvent, type CompileEvent as TCompileEvent } from '@package/contracts/wiki';
import type { CompileRunDispatcher } from '../application/ports.ts';
import type { DurableObjectNamespace } from './cf-types.ts';

// Bridges the oRPC `streamCompileEvents` handler (a regular Worker request)
// with a long-lived `CompileRunDO`. The DO holds the per-run state; the
// dispatcher just routes to it by name and parses SSE frames into typed
// CompileEvents.
export const createCfCompileRunDispatcher = (ns: DurableObjectNamespace): CompileRunDispatcher => ({
  async start({ compileRunId, folderId }) {
    const stub = ns.get(ns.idFromName(compileRunId));
    const res = await stub.fetch(
      new Request('https://compile-run/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'start', compileRunId, folderId }),
      }),
    );
    if (!res.ok && res.status !== 202) {
      throw new Error(`CompileRunDO start failed: ${res.status}`);
    }
  },

  async *subscribe(compileRunId) {
    const stub = ns.get(ns.idFromName(compileRunId));
    const res = await stub.fetch(new Request('https://compile-run/subscribe'));
    if (!res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      while (true) {
        const idx = buf.indexOf('\n\n');
        if (idx === -1) break;
        const frame = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 2);
        if (!frame) continue;
        const dataLines = frame
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim());
        const payload = dataLines.join('');
        if (!payload) continue;
        try {
          const parsed = CompileEvent.parse(JSON.parse(payload)) as TCompileEvent;
          yield parsed;
          if (parsed.kind === 'CompileFinished' || parsed.kind === 'CompileFailed') {
            // Terminal event — close the iterator. The DO's tape is durable;
            // re-subscribing will replay if needed.
            return;
          }
        } catch (err) {
          console.warn('[wiki dispatcher] dropped malformed SSE frame', err);
        }
      }
    }
  },
});
