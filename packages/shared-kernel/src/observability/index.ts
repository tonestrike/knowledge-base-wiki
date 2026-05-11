import { createConsoleTracer } from './console-exporter.ts';
import {
  type LangfuseEnv,
  createOtlpHttpTracer,
  langfuseOtlpConfig,
  parseOtlpHeaders,
} from './otlp-http-exporter.ts';
import type { Tracer } from './tracer.ts';

export type { Span, SpanAttributeValue, SpanAttributes, SpanStatus, Tracer } from './tracer.ts';
export { noOpTracer } from './no-op-tracer.ts';
export {
  type ConsoleSpanLine,
  type ConsoleTracerOptions,
  createConsoleTracer,
} from './console-exporter.ts';
export {
  type LangfuseEnv,
  type OtlpHttpTracerOptions,
  buildOtlpExportRequest,
  createOtlpHttpTracer,
  langfuseOtlpConfig,
  parseOtlpHeaders,
} from './otlp-http-exporter.ts';

/**
 * Env shape consulted by `resolveTracer`. The composition root passes the
 * Worker's `c.env` (or a stub in tests) — only these five keys matter.
 */
export interface TracerEnv extends LangfuseEnv {
  /** Generic OTLP/HTTP endpoint, e.g. `https://api.honeycomb.io`. */
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  /** Generic OTLP headers, e.g. `x-honeycomb-team=...`. */
  OTEL_EXPORTER_OTLP_HEADERS?: string;
}

export interface ResolveTracerOptions {
  /** Worker `executionCtx.waitUntil` — passed through to the OTLP exporter. */
  waitUntil?: (p: Promise<unknown>) => void;
  /** Override the service name attached to every exported span. */
  serviceName?: string;
}

/**
 * Pick the right tracer for the current environment, in this precedence:
 *
 *   1. Langfuse — if `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` +
 *      `LANGFUSE_HOST` are all set, derive the endpoint + Basic auth header
 *      automatically and use `createOtlpHttpTracer`.
 *   2. Generic OTLP — if `OTEL_EXPORTER_OTLP_ENDPOINT` is set, use it with
 *      whatever headers `OTEL_EXPORTER_OTLP_HEADERS` carries.
 *   3. Console — default. Logs one structured JSON line per finished span.
 *
 * Never throws on missing config; the caller can rely on a working tracer
 * regardless of environment.
 */
export const resolveTracer = (env: TracerEnv, options: ResolveTracerOptions = {}): Tracer => {
  const langfuse = langfuseOtlpConfig(env);
  if (langfuse) {
    return createOtlpHttpTracer({
      endpoint: langfuse.endpoint,
      headers: langfuse.headers,
      ...(options.serviceName !== undefined ? { serviceName: options.serviceName } : {}),
      ...(options.waitUntil ? { waitUntil: options.waitUntil } : {}),
    });
  }
  const generic = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (generic) {
    return createOtlpHttpTracer({
      endpoint: generic,
      headers: parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
      ...(options.serviceName !== undefined ? { serviceName: options.serviceName } : {}),
      ...(options.waitUntil ? { waitUntil: options.waitUntil } : {}),
    });
  }
  return createConsoleTracer();
};

/**
 * # withSpan — promise-shaped span helper
 *
 * Wrap an async function in a span. Records exceptions, sets `error` status
 * on throw, and `ok` on resolve. Returns whatever the inner function returns.
 *
 *   const out = await withSpan(tracer, 'llm.call', { 'gen_ai.system': 'anthropic' }, async (span) => {
 *     const res = await anthropic.messages.create(…);
 *     span.setAttribute('gen_ai.usage.input_tokens', res.usage.input_tokens);
 *     return res;
 *   });
 *
 * The inner function receives the live span so it can attach response-time
 * attributes (usage, model echo, latency-derived metrics) before `end()`.
 */
export const withSpan = async <T>(
  tracer: Tracer,
  name: string,
  attrs: import('./tracer.ts').SpanAttributes | undefined,
  fn: (span: import('./tracer.ts').Span) => Promise<T>,
): Promise<T> => {
  const span = tracer.startSpan(name, attrs);
  try {
    const out = await fn(span);
    span.setStatus('ok');
    return out;
  } catch (err) {
    span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
};

/**
 * Truncate prompt / completion previews to keep span payloads small.
 * 500 chars is enough to recognize "is this the system prompt I expect"
 * without blowing past Langfuse's per-attribute size budget.
 */
export const previewText = (text: string | undefined | null, max = 500): string | undefined => {
  if (!text) return undefined;
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
};
