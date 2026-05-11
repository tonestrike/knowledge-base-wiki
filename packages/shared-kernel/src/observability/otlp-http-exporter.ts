import type { Span, SpanAttributeValue, SpanAttributes, SpanStatus, Tracer } from './tracer.ts';

/**
 * # OTLP/HTTP tracer — Langfuse-ready exporter
 *
 * Speaks the OTLP/HTTP protobuf-over-JSON wire format directly (no SDK).
 * POSTs batches to `${endpoint}/v1/traces` with `application/json` and the
 * caller-supplied headers (which is where the Langfuse `Authorization: Basic`
 * lives). Works on Cloudflare Workers — only uses `fetch`, `Date`, and Web
 * Crypto for span ids; no `node:` deps.
 *
 * ## Why hand-roll instead of `@opentelemetry/otlp-exporter-http`
 *
 * The official Node exporter pulls in `node:http`, gRPC machinery, and a
 * 100kB+ bundle. Workers can't run any of that. The protocol itself is
 * stable, well-documented, and small enough that a fifty-line emitter is
 * the right cost/benefit trade for what we need today.
 *
 * ## Spec references
 *
 * - OTLP/HTTP: https://opentelemetry.io/docs/specs/otlp/#otlphttp
 * - JSON encoding: https://github.com/open-telemetry/opentelemetry-proto/blob/main/docs/specification.md
 * - GenAI semantic conventions: https://opentelemetry.io/docs/specs/semconv/gen-ai/
 *
 * ## Flush semantics
 *
 * Spans buffer in-memory; each `end()` schedules a flush. The caller passes
 * a `waitUntil` hook (typically `ctx.waitUntil` on Workers) so a request's
 * lifecycle keeps the export going after the response flushes. Without
 * `waitUntil`, the export fires-and-forgets — fine for dev / local runs,
 * lossy if the process exits before the fetch completes.
 */

// ── OTLP wire types (JSON encoding) ──────────────────────────────────────
// Modelled after the OTLP proto JSON mapping. We only emit what we set;
// everything else stays out of the payload (the backend tolerates absence).

type OtlpAttributeValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean };

interface OtlpAttribute {
  key: string;
  value: OtlpAttributeValue;
}

interface OtlpStatus {
  code: 0 | 1 | 2; // UNSET=0, OK=1, ERROR=2
  message?: string;
}

interface OtlpEvent {
  timeUnixNano: string;
  name: string;
  attributes?: OtlpAttribute[];
}

interface OtlpSpan {
  traceId: string; // 32 hex chars
  spanId: string; // 16 hex chars
  name: string;
  kind: 1; // SPAN_KIND_INTERNAL — we don't model client/server explicitly yet
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes?: OtlpAttribute[];
  status?: OtlpStatus;
  events?: OtlpEvent[];
}

interface OtlpExportRequest {
  resourceSpans: Array<{
    resource: { attributes: OtlpAttribute[] };
    scopeSpans: Array<{
      scope: { name: string; version?: string };
      spans: OtlpSpan[];
    }>;
  }>;
}

// ── Attribute coercion ───────────────────────────────────────────────────

const toOtlpAttr = (key: string, value: SpanAttributeValue): OtlpAttribute | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return { key, value: { stringValue: value } };
  if (typeof value === 'boolean') return { key, value: { boolValue: value } };
  if (typeof value === 'number') {
    // OTLP requires intValue as a string (proto int64 → JSON string).
    if (Number.isInteger(value) && Number.isFinite(value)) {
      return { key, value: { intValue: String(value) } };
    }
    if (Number.isFinite(value)) return { key, value: { doubleValue: value } };
  }
  // Anything weird (NaN, Infinity, etc.) → stringify so the span still ships.
  return { key, value: { stringValue: String(value) } };
};

const attrsToOtlp = (attrs: Record<string, SpanAttributeValue>): OtlpAttribute[] => {
  const out: OtlpAttribute[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    const a = toOtlpAttr(k, v);
    if (a) out.push(a);
  }
  return out;
};

// ── Header parsing ───────────────────────────────────────────────────────

/**
 * Parse the W3C-style header list used by `OTEL_EXPORTER_OTLP_HEADERS`.
 * Format: `key1=value1,key2=value2`. Whitespace around `=` and `,` is trimmed.
 * Values may contain URL-encoded characters (Langfuse's auth header doesn't,
 * but the spec allows it).
 *
 * Returns an empty object on a falsy input — silent on missing config is the
 * right default for a tracer.
 */
export const parseOtlpHeaders = (raw: string | undefined | null): Record<string, string> => {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;
    const value = trimmed.slice(eq + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
};

// ── Langfuse env-var derivation ──────────────────────────────────────────

export interface LangfuseEnv {
  LANGFUSE_HOST?: string;
  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
}

/**
 * Derive an OTLP endpoint + headers tuple from Langfuse env vars.
 *
 *   endpoint = `${LANGFUSE_HOST}/api/public/otel/v1/traces`
 *   headers.Authorization = `Basic base64(${publicKey}:${secretKey})`
 *
 * Returns `null` if any of the three vars are missing — the caller falls back
 * to the generic OTLP env vars (or ConsoleTracer) without throwing.
 */
export const langfuseOtlpConfig = (
  env: LangfuseEnv,
): { endpoint: string; headers: Record<string, string> } | null => {
  const host = env.LANGFUSE_HOST?.trim();
  const pk = env.LANGFUSE_PUBLIC_KEY?.trim();
  const sk = env.LANGFUSE_SECRET_KEY?.trim();
  if (!host || !pk || !sk) return null;
  // Strip trailing slash so we don't emit `…//api/public/…`.
  const base = host.replace(/\/+$/, '');
  // The OTLP exporter appends `/v1/traces`; Langfuse's collector lives at
  // `${host}/api/public/otel`. We pass the prefix here, and the request URL
  // is composed as `${endpoint}/v1/traces`. Both shapes appear in the
  // Langfuse self-hosting docs; this one matches the cloud collector
  // (cloud.langfuse.com/api/public/otel).
  const endpoint = `${base}/api/public/otel`;
  // btoa() is available on Cloudflare Workers + Bun. Latin-1 only is fine
  // here — both the public key and secret key are ASCII.
  const token = btoa(`${pk}:${sk}`);
  return {
    endpoint,
    headers: { Authorization: `Basic ${token}` },
  };
};

// ── Hex id generation ────────────────────────────────────────────────────

const HEX = '0123456789abcdef';

/**
 * Generate a random hex id of the requested byte length. Uses Web Crypto's
 * `getRandomValues` which is available on Workers + Bun + Node 20+.
 *
 * OTel ids: traceId = 16 bytes (32 hex), spanId = 8 bytes (16 hex). They must
 * be lowercase hex with leading zeros preserved.
 */
const randomHex = (bytes: number): string => {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i] ?? 0;
    out += HEX[(b >> 4) & 0xf] ?? '0';
    out += HEX[b & 0xf] ?? '0';
  }
  return out;
};

// ── Span state ───────────────────────────────────────────────────────────

const otlpStatusFrom = (
  status: SpanStatus,
  message: string | undefined,
): OtlpStatus | undefined => {
  if (status === 'error') {
    return message !== undefined ? { code: 2, message } : { code: 2 };
  }
  // OTel default is UNSET; we send OK explicitly only when the caller set it.
  return { code: 1 };
};

const toNano = (ms: number): string => {
  // ms × 1_000_000 fits in a JS number for the entire range we care about,
  // but proto demands a string for int64 — convert via BigInt to avoid
  // float-precision drift on very large epochs.
  return (BigInt(Math.floor(ms)) * 1_000_000n).toString();
};

// ── Tracer factory ───────────────────────────────────────────────────────

export interface OtlpHttpTracerOptions {
  /**
   * Base OTLP endpoint. The exporter appends `/v1/traces` — pass the host or
   * the prefix Langfuse expects (`${LANGFUSE_HOST}/api/public/otel`). Trailing
   * slashes are tolerated.
   */
  endpoint: string;
  /**
   * Additional headers. The exporter always sets `content-type: application/json`;
   * anything else (auth, tenant routing, etc.) belongs here.
   */
  headers?: Record<string, string>;
  /**
   * Service identifier surfaced on every span via `service.name`. Defaults
   * to `tenex-api` so Langfuse trace lists group sensibly.
   */
  serviceName?: string;
  /**
   * `ctx.waitUntil` on Cloudflare Workers. Keeps the export fetch alive past
   * the response flush. Falls back to fire-and-forget when omitted.
   */
  waitUntil?: (p: Promise<unknown>) => void;
  /**
   * `fetch` injection point — test hook. Default: `globalThis.fetch`.
   */
  fetchImpl?: typeof fetch;
  /**
   * Wall-clock injection. Default: `Date.now`.
   */
  now?: () => number;
}

interface PendingSpan {
  traceId: string;
  spanId: string;
  name: string;
  attrs: Record<string, SpanAttributeValue>;
  status: SpanStatus;
  statusMessage?: string;
  exception?: { name: string; message: string; stack?: string };
  startedAtMs: number;
  ended: boolean;
}

/**
 * Build the OTLP export envelope for a batch of finished spans. Exposed for
 * tests so they can assert on the wire shape without a live server.
 */
export const buildOtlpExportRequest = (
  spans: ReadonlyArray<OtlpSpan>,
  serviceName: string,
): OtlpExportRequest => ({
  resourceSpans: [
    {
      resource: {
        attributes: [{ key: 'service.name', value: { stringValue: serviceName } }],
      },
      scopeSpans: [
        {
          scope: { name: '@package/shared-kernel/observability', version: '0.0.0' },
          spans: [...spans],
        },
      ],
    },
  ],
});

export const createOtlpHttpTracer = (options: OtlpHttpTracerOptions): Tracer => {
  const endpoint = options.endpoint.replace(/\/+$/, '');
  const tracesUrl = `${endpoint}/v1/traces`;
  const headers = options.headers ?? {};
  const serviceName = options.serviceName ?? 'tenex-api';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? (() => Date.now());
  const waitUntil = options.waitUntil;

  const exportOne = async (span: OtlpSpan): Promise<void> => {
    try {
      const body = JSON.stringify(buildOtlpExportRequest([span], serviceName));
      const res = await fetchImpl(tracesUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body,
      });
      if (!res.ok) {
        // OTLP collectors typically return 4xx with a JSON body explaining
        // the rejection. We log + drop — there's no application-level retry
        // path that wouldn't risk amplifying load on a dying backend.
        console.warn(
          '[otlp-http-exporter] export rejected',
          res.status,
          await res.text().catch(() => ''),
        );
      }
    } catch (err) {
      // Network failure shouldn't propagate into the request path. The whole
      // point of observability is "best-effort additive instrumentation".
      console.warn('[otlp-http-exporter] export threw', err instanceof Error ? err.message : err);
    }
  };

  const makeSpan = (initial: PendingSpan): Span => {
    const state = initial;
    return {
      setAttribute(key, value) {
        if (state.ended) return;
        state.attrs[key] = value;
      },
      setAttributes(attrs: SpanAttributes) {
        if (state.ended) return;
        for (const [k, v] of Object.entries(attrs)) state.attrs[k] = v;
      },
      setStatus(status, message) {
        if (state.ended) return;
        state.status = status;
        if (message !== undefined) state.statusMessage = message;
      },
      recordException(err: unknown) {
        if (state.ended) return;
        if (err instanceof Error) {
          state.exception = {
            name: err.name,
            message: err.message,
            ...(err.stack ? { stack: err.stack } : {}),
          };
        } else {
          state.exception = { name: 'Error', message: String(err) };
        }
        state.status = 'error';
      },
      end() {
        if (state.ended) return;
        state.ended = true;
        const endedAtMs = now();
        const attrs = attrsToOtlp(state.attrs);
        const events: OtlpEvent[] = [];
        if (state.exception) {
          // OTel convention: exceptions are span events with the
          // `exception.*` attribute namespace.
          events.push({
            timeUnixNano: toNano(endedAtMs),
            name: 'exception',
            attributes: [
              { key: 'exception.type', value: { stringValue: state.exception.name } },
              { key: 'exception.message', value: { stringValue: state.exception.message } },
              ...(state.exception.stack
                ? [
                    {
                      key: 'exception.stacktrace',
                      value: { stringValue: state.exception.stack } as OtlpAttributeValue,
                    },
                  ]
                : []),
            ],
          });
        }
        const span: OtlpSpan = {
          traceId: state.traceId,
          spanId: state.spanId,
          name: state.name,
          kind: 1,
          startTimeUnixNano: toNano(state.startedAtMs),
          endTimeUnixNano: toNano(endedAtMs),
          ...(attrs.length > 0 ? { attributes: attrs } : {}),
          ...(events.length > 0 ? { events } : {}),
        };
        const status = otlpStatusFrom(state.status, state.statusMessage);
        if (status) span.status = status;

        const exportPromise = exportOne(span);
        if (waitUntil) {
          waitUntil(exportPromise);
        } else {
          // Fire-and-forget — chain a no-op `.catch` so an unhandled rejection
          // doesn't crash the worker; `exportOne` already swallows errors.
          exportPromise.catch(() => undefined);
        }
      },
    };
  };

  return {
    startSpan(name, attrs) {
      const initial: PendingSpan = {
        traceId: randomHex(16),
        spanId: randomHex(8),
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
