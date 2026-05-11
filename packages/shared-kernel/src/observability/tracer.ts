/**
 * # Tracer port — minimal OpenTelemetry-shaped tracing seam
 *
 * Framework-free observability port. Domain code depends on this interface,
 * never on a concrete tracer. The composition root in `apps/api` picks the
 * implementation (Console for dev, OTLP/HTTP for Langfuse-or-any-backend).
 *
 * Frame-of-reference: shapes mirror the OpenTelemetry SDK
 * (`startSpan` / `setAttribute` / `setStatus` / `recordException` / `end`)
 * so a future swap to the real `@opentelemetry/api` is mechanical. Kept
 * deliberately small — we don't need contexts, baggage, or propagation yet.
 *
 * Span attributes follow OTel's GenAI semantic conventions where they apply
 * (`gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`,
 * `gen_ai.usage.output_tokens`) so Langfuse / any GenAI-aware backend picks
 * up cost and token attribution automatically.
 */

/** Attribute primitives carried on a span. Aligns with OTel's `AttributeValue`. */
export type SpanAttributeValue = string | number | boolean | null | undefined;

export type SpanAttributes = Readonly<Record<string, SpanAttributeValue>>;

/** Status of a finished span. Maps to OTel's `SpanStatusCode.OK` / `ERROR`. */
export type SpanStatus = 'ok' | 'error';

/**
 * A live span. Attributes accumulate while the span is open; the implementation
 * snapshots them when `end()` is called and ships them to the backend.
 *
 * Spans are forgiving by contract:
 *  - `setAttribute` after `end()` is a no-op (never throws).
 *  - `end()` is idempotent — calling it twice is harmless.
 *  - `recordException` accepts anything and serializes a best-effort message.
 */
export interface Span {
  /** Attach an attribute. Last writer wins on collision. */
  setAttribute(key: string, value: SpanAttributeValue): void;
  /** Attach multiple attributes in one call. */
  setAttributes(attrs: SpanAttributes): void;
  /** Mark the span's terminal status. Defaults to `ok` if never set. */
  setStatus(status: SpanStatus, message?: string): void;
  /** Record an exception against this span; also flips status to `error`. */
  recordException(err: unknown): void;
  /** Finalize the span; the backend may flush it eagerly or batch. */
  end(): void;
}

/**
 * Tracer factory. The only public surface domain code touches.
 *
 * Implementations:
 *  - `noOpTracer` — used in tests; allocates nothing.
 *  - `createConsoleTracer()` — logs one structured JSON line per span on `end()`.
 *  - `createOtlpHttpTracer(...)` — batches finished spans and POSTs them to a
 *     generic OTLP/HTTP endpoint (Langfuse, Honeycomb, Grafana Cloud, etc.).
 */
export interface Tracer {
  /**
   * Start a new span. The returned span is "current" for the caller's logical
   * scope; nesting is by convention (pass the returned span around, or just
   * `end()` it from the same async path).
   */
  startSpan(name: string, attrs?: SpanAttributes): Span;
}
