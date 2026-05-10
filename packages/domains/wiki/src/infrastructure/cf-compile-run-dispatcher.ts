import { CompileEvent, type CompileEvent as TCompileEvent } from '@package/contracts/wiki';
import type { CompileRunDispatcher } from '../application/ports.ts';
import type { DurableObjectNamespace } from './cf-types.ts';

// Bridges the oRPC `streamCompileEvents` handler (a regular Worker request)
// with a long-lived `CompileRunDO`. The DO holds the per-run state; the
// dispatcher just routes to it by name and parses SSE frames into typed
// CompileEvents.

// SF10 — if the DO stops emitting frames (network hang, malformed terminal
// frame) the iterator would otherwise wait forever. We bound the read with
// a per-frame timeout and surface a synthetic CompileFailed event so the
// consumer (oRPC handler / live UI) can react.
const FRAME_TIMEOUT_MS = 60_000;
// SF7 — replay can include events that the live stream re-emits later; we
// dedupe on the (seq, kind, compileRunId) tuple so the consumer never sees
// the same event twice.

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
    const seenSeq = new Set<number>();

    type ReadResult = { done: true; value?: Uint8Array } | { done: false; value: Uint8Array };
    const readWithTimeout = async (): Promise<ReadResult | 'timeout'> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), FRAME_TIMEOUT_MS);
      });
      try {
        return await Promise.race([reader.read() as Promise<ReadResult>, timeout]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    while (true) {
      const next = await readWithTimeout();
      if (next === 'timeout') {
        // SF10 — surface a synthetic CompileFailed so consumers react.
        yield {
          kind: 'CompileFailed',
          compileRunId,
          message: `dispatcher timeout: no frame from CompileRunDO in ${FRAME_TIMEOUT_MS}ms`,
        } as TCompileEvent;
        return;
      }
      const { done, value } = next;
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
        let outer: { seq?: unknown; event?: unknown };
        try {
          outer = JSON.parse(payload) as { seq?: unknown; event?: unknown };
        } catch (parseErr) {
          // SF10 — surface as a synthetic CompileFailed instead of warn-and-continue.
          yield {
            kind: 'CompileFailed',
            compileRunId,
            message: `malformed SSE frame: ${
              parseErr instanceof Error ? parseErr.message : String(parseErr)
            }`,
          } as TCompileEvent;
          return;
        }
        if (typeof outer !== 'object' || outer === null || typeof outer.seq !== 'number') {
          yield {
            kind: 'CompileFailed',
            compileRunId,
            message: 'malformed SSE frame: missing seq',
          } as TCompileEvent;
          return;
        }
        if (seenSeq.has(outer.seq)) continue;
        seenSeq.add(outer.seq);

        try {
          const parsed = CompileEvent.parse(outer.event) as TCompileEvent;
          yield parsed;
          if (parsed.kind === 'CompileFinished' || parsed.kind === 'CompileFailed') {
            // Terminal event — close the iterator. The DO's tape is durable;
            // re-subscribing will replay if needed.
            return;
          }
        } catch (err) {
          yield {
            kind: 'CompileFailed',
            compileRunId,
            message: `malformed CompileEvent payload: ${
              err instanceof Error ? err.message : String(err)
            }`,
          } as TCompileEvent;
          return;
        }
      }
    }
  },
});
