import { AnswerEvent as AnswerEventSchema } from '@package/contracts/chat';
import type { AnswerEvent } from '@package/contracts/chat';
import type { ConversationDispatcher } from '../application/ports.ts';
import type { DurableObjectNamespace } from './cf-types.ts';

// Bridges the oRPC `chat.streamAnswer` handler with a long-lived ChatTurnDO.
// The DO holds the per-turn tape; the dispatcher routes by name and parses
// SSE frames into typed AnswerEvents.

// SF — bound each frame read so a stalled DO doesn't wedge the iterator
// forever. 60s is generous enough to span a slow Sonnet turn between events
// while still surfacing a real hang inside the per-turn 5-minute budget.
const FRAME_TIMEOUT_MS = 60_000;

const doIdFor = (conversationId: string, turnId: string): string => `${conversationId}:${turnId}`;

export const createCfChatTurnDispatcher = (ns: DurableObjectNamespace): ConversationDispatcher => ({
  async start({ conversationId, turnId, wikiId, question, waitUntil }) {
    const stub = ns.get(ns.idFromName(doIdFor(conversationId, turnId)));
    // We don't await the fetch — the DO's /start returns 202 instantly
    // once it has anchored the run via state.waitUntil. The chat.ask
    // oRPC handler is supposed to return the turnId synchronously and
    // let the SSE consumer pick up via /subscribe.
    const startPromise = stub.fetch(
      new Request('https://chat-turn/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'start', conversationId, turnId, wikiId, question }),
      }),
    );
    // Anchor the start request through the originating Worker's
    // waitUntil so it isn't cancelled when chat.ask responds.
    if (waitUntil) waitUntil(startPromise);
    const res = await startPromise;
    if (!res.ok && res.status !== 202) {
      throw new Error(`ChatTurnDO start failed: ${res.status}`);
    }
  },

  subscribe({ conversationId, turnId }) {
    return {
      [Symbol.asyncIterator](): AsyncIterator<AnswerEvent> {
        // `reader` is typed `unknown` because both web-streams and
        // workers-types ship a ReadableStreamDefaultReader interface and
        // tsc cross-references them on Workers builds. We only ever call
        // `.read()` and `.cancel()` on it; narrow at the call site.
        let reader: { read(): Promise<ReadResult>; cancel(): Promise<void> } | null = null;
        const decoder = new TextDecoder();
        let buf = '';
        const seenSeq = new Set<number>();
        let terminal = false;

        const ensureReader = async (): Promise<{
          read(): Promise<ReadResult>;
          cancel(): Promise<void>;
        }> => {
          if (reader) return reader;
          const stub = ns.get(ns.idFromName(doIdFor(conversationId, turnId)));
          const res = await stub.fetch(new Request('https://chat-turn/subscribe'));
          if (!res.body) throw new Error('ChatTurnDO /subscribe returned no body');
          reader = (res.body as unknown as { getReader(): typeof reader }).getReader() as {
            read(): Promise<ReadResult>;
            cancel(): Promise<void>;
          };
          return reader;
        };

        type ReadResult = { done: true; value?: Uint8Array } | { done: false; value: Uint8Array };
        const readWithTimeout = async (r: {
          read(): Promise<ReadResult>;
        }): Promise<ReadResult | 'timeout'> => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const timeout = new Promise<'timeout'>((resolve) => {
            timer = setTimeout(() => resolve('timeout'), FRAME_TIMEOUT_MS);
          });
          try {
            return await Promise.race([r.read(), timeout]);
          } finally {
            if (timer) clearTimeout(timer);
          }
        };

        return {
          async next(): Promise<IteratorResult<AnswerEvent>> {
            if (terminal) return { value: undefined as unknown as AnswerEvent, done: true };
            const r = await ensureReader();
            while (true) {
              // Drain any complete frames already buffered.
              const idx = buf.indexOf('\n\n');
              if (idx !== -1) {
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
                } catch {
                  continue;
                }
                if (typeof outer.seq !== 'number') continue;
                if (seenSeq.has(outer.seq)) continue;
                seenSeq.add(outer.seq);
                const parsed = AnswerEventSchema.safeParse(outer.event);
                if (!parsed.success) continue;
                const evt = parsed.data;
                if (evt.kind === 'AnswerFinished' || evt.kind === 'AnswerFailed') {
                  terminal = true;
                }
                return { value: evt, done: false };
              }
              // Need more bytes.
              const next = await readWithTimeout(r);
              if (next === 'timeout') {
                terminal = true;
                return {
                  value: {
                    kind: 'AnswerFailed',
                    turnId: turnId,
                    message: `dispatcher timeout: no frame from ChatTurnDO in ${FRAME_TIMEOUT_MS}ms`,
                  } as AnswerEvent,
                  done: false,
                };
              }
              const { done, value } = next;
              if (done) {
                terminal = true;
                return { value: undefined as unknown as AnswerEvent, done: true };
              }
              buf += decoder.decode(value, { stream: true });
            }
          },
          async return(): Promise<IteratorResult<AnswerEvent>> {
            terminal = true;
            if (reader) {
              try {
                await reader.cancel();
              } catch {
                // ignore
              }
            }
            return { value: undefined as unknown as AnswerEvent, done: true };
          },
        };
      },
    };
  },
});
