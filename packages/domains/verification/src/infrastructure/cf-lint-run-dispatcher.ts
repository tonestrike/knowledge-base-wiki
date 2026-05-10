import type { LintRunId, WikiId } from '@package/contracts/shared';
import { LintEvent } from '@package/contracts/verification';
import type { LintRunDispatcher } from '../application/ports.ts';

// Minimal Durable Object Namespace surface — define locally to avoid pulling
// in @cloudflare/workers-types.
export interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}
export interface DurableObjectId {
  toString(): string;
}
export interface DurableObjectStub {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
}

export const createCfLintRunDispatcher = (
  namespace: DurableObjectNamespace,
): LintRunDispatcher => ({
  async start({ lintRunId, wikiId }) {
    const stub = namespace.get(namespace.idFromName(lintRunId));
    const res = await stub.fetch('https://lint-run-do/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'start', lintRunId, wikiId }),
    });
    if (!res.ok && res.status !== 202) {
      throw new Error(`LintRunDO start failed: ${res.status}`);
    }
  },

  async *subscribe(lintRunId: LintRunId): AsyncIterable<LintEvent> {
    const stub = namespace.get(namespace.idFromName(lintRunId));
    const res = await stub.fetch('https://lint-run-do/subscribe', { method: 'GET' });
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      // Each SSE event is delimited by a blank line.
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const block of events) {
        const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
        if (!dataLine) continue;
        try {
          const parsed = LintEvent.parse(JSON.parse(dataLine.slice(6)));
          yield parsed;
        } catch {
          // skip malformed
        }
      }
    }
  },
});

// Used by app layers to satisfy unused-export checks; harmless re-export.
export type { WikiId, LintRunId };
