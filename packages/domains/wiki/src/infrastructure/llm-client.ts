import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { type Tracer, noOpTracer, previewText } from '@package/shared-kernel';
import { generateObject } from 'ai';
import type { z } from 'zod';
import type { LlmClient } from '../application/ports.ts';

export interface LlmClientConfig {
  apiKey: string;
  // Optional metadata so OpenRouter ranks our requests; safe to omit.
  appName?: string;
  appUrl?: string;
  // SF8 — exponential-backoff retry for transient errors (429 / 5xx).
  // Schema-validation errors (Vercel AI SDK throws AI_NoObjectGeneratedError /
  // AI_ToolCallValidationError) are passed through — the prompt won't
  // suddenly produce valid output on a retry. Defaults: up to 3 attempts,
  // base 500ms, capped 8s.
  retry?: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  };
  /**
   * Per-call timeout in ms. The Vercel AI SDK never gives up on a stuck
   * upstream request, so a single hung Researcher call would freeze the
   * whole CompileRunDO until the 30s subrequest CPU budget tripped. We
   * abort each call here so the caller can surface a typed error and the
   * orchestrator can move on to the next source. Default 120s.
   */
  timeoutMs?: number;
  /**
   * Optional Tracer. Every `generateObject` call is wrapped in an
   * `llm.call` span with OTel GenAI semantic-convention attributes
   * (`gen_ai.system`, `gen_ai.request.model`, usage tokens, prompt /
   * completion previews, latency). Defaults to `noOpTracer` so existing
   * call sites (and unit tests) keep working unchanged.
   */
  tracer?: Tracer;
}

// SF8 — match transient HTTP failures off the AI SDK error surface. The
// SDK rethrows the upstream error as `APICallError` (or wraps it) and
// exposes statusCode / responseHeaders. We sniff status + Retry-After and
// pass validation errors through without retrying.
interface SdkErrorShape {
  name?: string;
  statusCode?: number;
  responseHeaders?: Record<string, string>;
}

const isTransientError = (err: unknown): err is SdkErrorShape => {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as SdkErrorShape;
  if (typeof e.statusCode === 'number' && (e.statusCode === 429 || e.statusCode >= 500)) {
    return true;
  }
  // Network-class errors (no statusCode at all) are also transient.
  if (e.name === 'APICallError' && e.statusCode === undefined) return true;
  return false;
};

const isValidationError = (err: unknown): boolean => {
  if (typeof err !== 'object' || err === null) return false;
  const name = (err as { name?: string }).name ?? '';
  return (
    name === 'AI_NoObjectGeneratedError' ||
    name === 'NoObjectGeneratedError' ||
    name === 'AI_ToolCallValidationError' ||
    name === 'ZodError'
  );
};

const retryAfterMs = (err: SdkErrorShape): number | null => {
  const raw = err.responseHeaders?.['retry-after'] ?? err.responseHeaders?.['Retry-After'];
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  // HTTP-date format — clamp to 60s; an exact parse isn't worth it for a
  // best-effort backoff hint.
  return 60_000;
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Vercel AI SDK + OpenRouter adapter. Per spec §1.A, raw `@anthropic-ai/sdk`
// is forbidden in Phase 2 — every agent goes through this single adapter so
// we can swap providers (Anthropic-direct, Bedrock, OpenRouter) without
// touching application code. `generateObject` returns structured JSON
// against a Zod schema; we pass through token usage for downstream metering.
export const createLlmClient = (config: LlmClientConfig): LlmClient => {
  const openrouter = createOpenRouter({
    apiKey: config.apiKey,
    headers: {
      ...(config.appUrl ? { 'HTTP-Referer': config.appUrl } : {}),
      ...(config.appName ? { 'X-Title': config.appName } : {}),
    },
  });

  const maxAttempts = config.retry?.maxAttempts ?? 3;
  const baseDelay = config.retry?.baseDelayMs ?? 500;
  const maxDelay = config.retry?.maxDelayMs ?? 8_000;
  const timeoutMs = config.timeoutMs ?? 120_000;
  const tracer = config.tracer ?? noOpTracer;

  return {
    async generateObject<TSchema extends z.ZodTypeAny>({
      model,
      system,
      prompt,
      schema,
      schemaName,
      schemaDescription,
      maxTokens = 2000,
      temperature = 0,
    }: {
      model: string;
      system: string;
      prompt: string;
      schema: TSchema;
      schemaName?: string;
      schemaDescription?: string;
      maxTokens?: number;
      temperature?: number;
    }) {
      // One outer span covering the whole retry loop — token/latency
      // attribution accumulates onto this span on the successful attempt;
      // a transient error path leaves the span ended with the last
      // exception recorded.
      const span = tracer.startSpan('llm.call', {
        'gen_ai.system': 'openrouter',
        'gen_ai.request.model': model,
        'gen_ai.operation.name': 'generateObject',
        provider: 'openrouter',
        model,
        'prompt.preview': previewText(prompt) ?? '',
        'system.preview': previewText(system) ?? '',
        ...(schemaName ? { 'schema.name': schemaName } : {}),
      });
      const callStart = Date.now();
      let attempt = 0;
      try {
        while (true) {
          attempt++;
          const ac = new AbortController();
          const timer = setTimeout(() => ac.abort(), timeoutMs);
          try {
            const res = await generateObject({
              // Pin OpenRouter routing to Anthropic-direct. OpenRouter
              // otherwise picks the cheapest provider; today
              // anthropic/claude-* falls back to Amazon Bedrock, which
              // rejects `output_config.format.schema` shapes the chat /
              // wiki domains depend on ("For 'array' type, property
              // 'maxItems' is not supported", empty-`{}` rejection, etc.).
              // `allow_fallbacks: false` makes the failure mode a loud 400
              // from OpenRouter instead of a silent degradation.
              model: openrouter.chat(model, {
                provider: { order: ['anthropic'], allow_fallbacks: false },
                // biome-ignore lint/suspicious/noExplicitAny: provider-package cast — see comment in build-chat-context.ts.
              }) as any,
              system,
              prompt,
              schema,
              schemaName,
              schemaDescription,
              maxOutputTokens: maxTokens,
              temperature,
              // Disable AI SDK's internal retry-with-feedback. Our LlmClient
              // wrapper handles transient errors (429/5xx) explicitly; for
              // schema-validation failures we want to fail fast and let the
              // orchestrator skip that source rather than hang for 60-90s
              // per task on retries that historically don't recover.
              maxRetries: 0,
              abortSignal: ac.signal,
            });
            clearTimeout(timer);
            const inputTokens = res.usage?.inputTokens ?? 0;
            const outputTokens = res.usage?.outputTokens ?? 0;
            span.setAttributes({
              'gen_ai.usage.input_tokens': inputTokens,
              'gen_ai.usage.output_tokens': outputTokens,
              'gen_ai.attempts': attempt,
              'completion.preview': previewText(JSON.stringify(res.object)) ?? '',
              latency_ms: Date.now() - callStart,
            });
            span.setStatus('ok');
            return {
              result: res.object as z.infer<TSchema>,
              inputTokens,
              outputTokens,
            };
          } catch (err) {
            clearTimeout(timer);
            // AbortController fires on timeout — surface as a typed error
            // so the orchestrator can move on to the next source.
            if (ac.signal.aborted) {
              const timeoutErr = new Error(
                `LLM call timed out after ${timeoutMs}ms (model=${model})`,
              );
              span.recordException(timeoutErr);
              throw timeoutErr;
            }
            // Don't retry validation errors — the prompt isn't going to
            // suddenly produce a different shape on the next attempt.
            if (isValidationError(err)) {
              span.recordException(err);
              throw err;
            }
            if (!isTransientError(err) || attempt >= maxAttempts) {
              span.recordException(err);
              throw err;
            }
            const hint = retryAfterMs(err as SdkErrorShape);
            const backoff = hint ?? Math.min(maxDelay, baseDelay * 2 ** (attempt - 1));
            await sleep(backoff);
          }
        }
      } finally {
        span.end();
      }
    },
  };
};
