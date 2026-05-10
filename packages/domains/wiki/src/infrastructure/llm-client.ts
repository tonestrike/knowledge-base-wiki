import { createOpenRouter } from '@openrouter/ai-sdk-provider';
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
      let attempt = 0;
      while (true) {
        attempt++;
        try {
          const res = await generateObject({
            model: openrouter.chat(model),
            system,
            prompt,
            schema,
            schemaName,
            schemaDescription,
            maxTokens,
            temperature,
          });
          return {
            result: res.object as z.infer<TSchema>,
            inputTokens: res.usage?.promptTokens ?? 0,
            outputTokens: res.usage?.completionTokens ?? 0,
          };
        } catch (err) {
          // Don't retry validation errors — the prompt isn't going to
          // suddenly produce a different shape on the next attempt.
          if (isValidationError(err)) throw err;
          if (!isTransientError(err) || attempt >= maxAttempts) throw err;
          const hint = retryAfterMs(err as SdkErrorShape);
          const backoff = hint ?? Math.min(maxDelay, baseDelay * 2 ** (attempt - 1));
          await sleep(backoff);
        }
      }
    },
  };
};
