import type { Span, SpanAttributeValue, SpanAttributes, SpanStatus, Tracer } from './tracer.ts';

/**
 * No-op span and tracer. Allocates the smallest possible object that satisfies
 * the interface; every method is a synchronous no-op.
 *
 * Used in:
 *  - Domain unit tests that don't care about tracing (pass `noOpTracer` to
 *    construct a context without setting up an exporter).
 *  - The boot path when neither Langfuse nor a generic OTLP endpoint is
 *    configured (the composition root falls back to `createConsoleTracer()`
 *    by default; `noOpTracer` is reserved for tests where even console
 *    output would be noise).
 */
const noOpSpan: Span = {
  setAttribute(_key: string, _value: SpanAttributeValue): void {
    /* no-op */
  },
  setAttributes(_attrs: SpanAttributes): void {
    /* no-op */
  },
  setStatus(_status: SpanStatus, _message?: string): void {
    /* no-op */
  },
  recordException(_err: unknown): void {
    /* no-op */
  },
  end(): void {
    /* no-op */
  },
};

export const noOpTracer: Tracer = {
  startSpan(_name: string, _attrs?: SpanAttributes): Span {
    return noOpSpan;
  },
};
