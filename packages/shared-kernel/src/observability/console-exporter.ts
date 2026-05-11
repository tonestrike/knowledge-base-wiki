import type { Span, SpanAttributeValue, SpanAttributes, SpanStatus, Tracer } from './tracer.ts';

/**
 * # ConsoleTracer — dev default
 *
 * One structured JSON line per `end()`. Picks up automatically in `bun run dev`
 * via `wrangler tail`, so a developer running locally can `grep '"span"'` over
 * the wrangler output and see every LLM call's model, token usage, latency,
 * and prompt preview.
 *
 * Stays compatible with the OTel GenAI semantic conventions: attributes are
 * passed through verbatim. The exception is `prompt.preview` / `completion.preview`
 * which are non-standard but useful for at-a-glance debugging — they're
 * truncated to 500 chars at the call site, not here.
 *
 * Why not use the real `@opentelemetry/sdk-node` console exporter:
 *  - Cloudflare Workers has no `node:` runtime; the OTel Node SDK is unusable.
 *  - Zero-dep + ~30 lines means cold-start cost is negligible (we measured a
 *    constructor that allocates a single closure).
 *  - The output shape is the same JSON keys an OTLP backend expects, so reading
 *    a console line is a faithful preview of what a Langfuse trace would carry.
 */

interface PendingSpan {
  name: string;
  attrs: Record<string, SpanAttributeValue>;
  status: SpanStatus;
  statusMessage?: string;
  exception?: { name: string; message: string; stack?: string };
  startedAtMs: number;
  ended: boolean;
}

const safeIsoNow = (ms: number): string => {
  try {
    return new Date(ms).toISOString();
  } catch {
    return new Date(0).toISOString();
  }
};

const exceptionShape = (err: unknown): { name: string; message: string; stack?: string } => {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, ...(err.stack ? { stack: err.stack } : {}) };
  }
  return { name: 'Error', message: String(err) };
};

/**
 * Shape of the JSON line emitted on `end()`. Keys are stable so log queries
 * (`jq '. | select(.span == "llm.call")'`) work without surprises.
 */
export interface ConsoleSpanLine {
  /** Discriminator so other JSON log lines don't collide. */
  span: string;
  /** Wall-clock ISO of when the span started. */
  startedAt: string;
  /** Wall-clock ISO of when the span ended. */
  endedAt: string;
  /** Duration in milliseconds; nullable if the clock went backwards. */
  durationMs: number;
  /** `ok` | `error`. */
  status: SpanStatus;
  /** Optional human-readable status hint. */
  statusMessage?: string;
  /** All attributes attached during the span's lifetime. */
  attributes: Record<string, SpanAttributeValue>;
  /** Captured exception, if any. */
  exception?: { name: string; message: string; stack?: string };
}

export interface ConsoleTracerOptions {
  /**
   * Where to write each span line. Defaults to `console.info` — wrangler dev's
   * stdout captures this. Tests inject a sink so they can assert on output
   * without spamming the runner.
   */
  sink?: (line: ConsoleSpanLine) => void;
  /**
   * Inject the wall clock for deterministic tests. Default: `Date.now`.
   */
  now?: () => number;
}

export const createConsoleTracer = (options: ConsoleTracerOptions = {}): Tracer => {
  const sink = options.sink ?? ((line: ConsoleSpanLine) => console.info(JSON.stringify(line)));
  const now = options.now ?? (() => Date.now());

  const makeSpan = (initial: PendingSpan): Span => {
    const state = initial;
    const span: Span = {
      setAttribute(key, value) {
        if (state.ended) return;
        state.attrs[key] = value;
      },
      setAttributes(attrs: SpanAttributes) {
        if (state.ended) return;
        for (const [k, v] of Object.entries(attrs)) state.attrs[k] = v;
      },
      setStatus(status: SpanStatus, message?: string) {
        if (state.ended) return;
        state.status = status;
        if (message !== undefined) state.statusMessage = message;
      },
      recordException(err: unknown) {
        if (state.ended) return;
        state.exception = exceptionShape(err);
        state.status = 'error';
      },
      end() {
        if (state.ended) return;
        state.ended = true;
        const endedAtMs = now();
        const line: ConsoleSpanLine = {
          span: state.name,
          startedAt: safeIsoNow(state.startedAtMs),
          endedAt: safeIsoNow(endedAtMs),
          durationMs: Math.max(0, endedAtMs - state.startedAtMs),
          status: state.status,
          ...(state.statusMessage !== undefined ? { statusMessage: state.statusMessage } : {}),
          attributes: { ...state.attrs },
          ...(state.exception ? { exception: state.exception } : {}),
        };
        sink(line);
      },
    };
    return span;
  };

  return {
    startSpan(name, attrs) {
      const initial: PendingSpan = {
        name,
        attrs: attrs ? { ...attrs } : {},
        status: 'ok',
        startedAtMs: now(),
        ended: false,
      };
      return makeSpan(initial);
    },
  };
};
