/**
 * # llm.call span helpers
 *
 * Every LLM adapter (`wiki/llm-client`, `verification/anthropic-verifier`,
 * `chat/agentic-researcher`, `chat/ai-sdk-synthesizer`) needs to emit the
 * same `llm.call` span, with the same OTel GenAI semantic-convention
 * attributes on open and the same usage-recording attributes on success.
 *
 * The lifecycle around the call varies (retry loops, streaming usage
 * settlement, abort controllers), so we don't try to encapsulate the whole
 * flow — instead these helpers factor the two repetitive blocks:
 *
 *   - {@link startLlmCallSpan} — open the span with the standard attribute set
 *   - {@link recordLlmUsage}   — attach the standard usage attributes
 *
 * Adapters keep ownership of try/catch/finally, retry timing, and stream
 * draining; only the attribute-name choices and previewing are shared.
 */

import { previewText } from './preview-text.ts';
import type { Span, SpanAttributes, Tracer } from './tracer.ts';

/**
 * Initial attributes for an `llm.call` span. Mirrors the OTel GenAI
 * semantic conventions; `system` doubles as `gen_ai.system` and `provider`,
 * `model` doubles as `gen_ai.request.model` and `model`. Adapters pass
 * raw prompt/system strings — the helper truncates via {@link previewText}.
 */
export interface LlmCallStart {
  /** GenAI provider identifier: `openrouter`, `anthropic`, `openai`, etc. */
  readonly system: string;
  /** Model id as the provider knows it (e.g. `anthropic/claude-opus-4-7`). */
  readonly model: string;
  /** Operation tag: `generateObject`, `verifier.audit`, `researcher.loop`, etc. */
  readonly operation: string;
  /** Raw user prompt; truncated to {@link previewText}'s default. */
  readonly prompt?: string;
  /** Raw system prompt; truncated to {@link previewText}'s default. */
  readonly systemPrompt?: string;
  /** Adapter-specific attributes (`chat.wiki_id`, `verifier.claim_id`, etc.). */
  readonly extra?: SpanAttributes;
}

/**
 * Usage attributes recorded on success. Latency is wall-clock from the
 * moment the helper started the span; the helper threads a closure that
 * captures the start `Date.now()`.
 */
export interface LlmCallUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Stringified model output; truncated to {@link previewText}'s default. */
  readonly completion?: string;
  /** Set when the adapter ran a retry loop; recorded as `gen_ai.attempts`. */
  readonly attempts?: number;
  /** Adapter-specific success attributes (`verifier.verdict`, etc.). */
  readonly extra?: SpanAttributes;
}

/**
 * An open `llm.call` span paired with a helper that records the standard
 * usage attributes (including the elapsed `latency_ms`). Adapters call:
 *
 *   const call = startLlmCallSpan(tracer, { system, model, operation, prompt, systemPrompt, extra });
 *   try {
 *     const res = await actualLlmCall(...);
 *     call.recordSuccess({ inputTokens, outputTokens, completion });
 *     return res;
 *   } catch (err) {
 *     call.span.recordException(err);
 *     throw err;
 *   } finally {
 *     call.span.end();
 *   }
 *
 * `span` is the live Span; callers use it for adapter-specific attributes
 * during the call (e.g. `call.span.setAttribute('chat.duplicate', true)`)
 * and for `recordException` / `end` in the error/finally branches.
 */
export interface LlmCall {
  readonly span: Span;
  recordSuccess(usage: LlmCallUsage): void;
}

/**
 * Open an `llm.call` span pre-populated with the standard GenAI attributes.
 * See {@link LlmCall} for the full usage pattern.
 */
export const startLlmCallSpan = (tracer: Tracer, start: LlmCallStart): LlmCall => {
  const callStart = Date.now();
  const attrs: Record<string, SpanAttributes[string]> = {
    'gen_ai.system': start.system,
    'gen_ai.request.model': start.model,
    'gen_ai.operation.name': start.operation,
    provider: start.system,
    model: start.model,
    'prompt.preview': previewText(start.prompt) ?? '',
    'system.preview': previewText(start.systemPrompt) ?? '',
    ...start.extra,
  };
  const span = tracer.startSpan('llm.call', attrs);
  return {
    span,
    recordSuccess(usage) {
      span.setAttributes({
        'gen_ai.usage.input_tokens': usage.inputTokens,
        'gen_ai.usage.output_tokens': usage.outputTokens,
        latency_ms: Date.now() - callStart,
        ...(usage.completion !== undefined
          ? { 'completion.preview': previewText(usage.completion) ?? '' }
          : {}),
        ...(usage.attempts !== undefined ? { 'gen_ai.attempts': usage.attempts } : {}),
        ...usage.extra,
      });
      span.setStatus('ok');
    },
  };
};
