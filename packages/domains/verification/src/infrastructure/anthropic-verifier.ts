import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { type Tracer, noOpTracer, startLlmCallSpan } from '@package/shared-kernel';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { AnthropicVerifier } from '../application/ports.ts';

// Verifier model + temperature are LOAD-BEARING per the 1.A risk-spike report
// (10/10 catches on the planted contradiction). Do not change without re-running
// the determinism probe.
export const VERIFIER_MODEL = 'anthropic/claude-opus-4-7';
export const VERIFIER_TEMPERATURE = 0;

// Bedrock-via-OpenRouter rejects JSON Schema array length constraints other
// than 0/1 (per spec §5.1.1) — keep the schema constraint-light here and
// rely on the prompt + Zod post-validation.
const VerdictSchema = z.object({
  verdict: z.enum(['supported', 'unsupported', 'contradicted']),
  evidenceText: z.string().min(1).max(2000),
  correction: z
    .object({
      replacementText: z.string().min(1).max(2000),
      newCitationLabel: z.string().min(1).max(200).optional(),
    })
    .optional(),
});

const SYSTEM_PROMPT = `You are Verifier. You audit a single Claim against the verbatim cited Spans.

Rules:
- Read the Claim text, then read each cited slice in order.
- Decide ONE verdict:
  - "supported" — the cited slices, taken together, contain enough information to substantiate the claim.
  - "unsupported" — no cited slice contains the information; the claim might still be true, but the citations don't show it.
  - "contradicted" — at least one cited slice asserts something incompatible with the claim.
- Quote evidence verbatim from a cited slice in "evidenceText" — do NOT paraphrase.
- For "unsupported" or "contradicted", you MUST propose a Correction whose replacementText is supported by the cited slices.

Return JSON: { verdict, evidenceText, correction?: { replacementText, newCitationLabel? } }.`;

export interface AnthropicVerifierOptions {
  apiKey: string;
  baseURL?: string;
  model?: string;
  temperature?: number;
  appName?: string;
  appUrl?: string;
  maxTokens?: number;
  // Bounded retry on transient OpenRouter errors. Default 3 attempts (= 1
  // initial + 2 retries) with exponential backoff. See PR #6
  // silent-failure-hunter finding 8.
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  // Injected for tests; in prod this is `setTimeout`-based.
  sleep?: (ms: number) => Promise<void>;
  /**
   * Optional Tracer. Every `audit()` call wraps `generateObject` in an
   * `llm.call` span with OTel GenAI semantic-convention attributes. Falls
   * back to `noOpTracer` so existing call sites keep working unchanged.
   */
  tracer?: Tracer;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// HTTP status codes worth retrying. 429 = rate limit; 5xx = server error or
// upstream transient issue. 4xx other than 429 are caller bugs and must NOT
// retry. Schema-validation rejections from generateObject (Vercel AI SDK
// throws AI_NoObjectGeneratedError or AI_TypeValidationError) are also NOT
// retried — same prompt + temperature 0 will reproduce the same bad output.
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const isRetryable = (err: unknown): boolean => {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: unknown; statusCode?: unknown; name?: unknown };
  // Schema-validation errors from Vercel AI SDK — never retry.
  if (
    typeof e.name === 'string' &&
    /TypeValidation|NoObjectGenerated|InvalidArgument/i.test(e.name)
  ) {
    return false;
  }
  const status =
    typeof e.status === 'number'
      ? e.status
      : typeof e.statusCode === 'number'
        ? e.statusCode
        : undefined;
  if (status === undefined) {
    // Network / fetch errors typically have no status — treat as transient.
    return true;
  }
  return RETRYABLE_STATUSES.has(status);
};

// Wraps Vercel AI SDK + @openrouter/ai-sdk-provider. The 1.A spike proved this
// path works; raw Anthropic-style prefill returns 400 against OpenRouter+Opus,
// and AI SDK's generateObject uses tool-call structured output under the hood.
export const createAnthropicVerifier = (opts: AnthropicVerifierOptions): AnthropicVerifier => {
  const provider = createOpenRouter({
    apiKey: opts.apiKey,
    ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    ...(opts.appName ? { appName: opts.appName } : {}),
    ...(opts.appUrl ? { appUrl: opts.appUrl } : {}),
  });
  const modelId = opts.model ?? VERIFIER_MODEL;
  const temperature = opts.temperature ?? VERIFIER_TEMPERATURE;
  const maxTokens = opts.maxTokens ?? 800;
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const baseDelayMs = Math.max(0, opts.retryBaseDelayMs ?? 500);
  const sleep = opts.sleep ?? defaultSleep;
  const tracer = opts.tracer ?? noOpTracer;

  return {
    async audit({ claim, citedSlices }) {
      const slicesXml = citedSlices
        .map((s) => `<slice citationId="${s.citationId}">\n${escapeForXml(s.sliceText)}\n</slice>`)
        .join('\n');
      const userPrompt = `Claim:\n${claim.claimText}\n\nCited slices:\n${slicesXml}`;

      const call = startLlmCallSpan(tracer, {
        system: 'openrouter',
        model: modelId,
        operation: 'verifier.audit',
        prompt: userPrompt,
        systemPrompt: SYSTEM_PROMPT,
        extra: {
          'verifier.claim_id': claim.id,
          'verifier.citation_count': citedSlices.length,
        },
      });
      let lastError: unknown;
      try {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            const { object, usage } = await generateObject({
              model: provider.chat(modelId),
              schema: VerdictSchema,
              schemaName: 'Verdict',
              schemaDescription: 'Verifier verdict for a single Claim against its cited Spans.',
              system: SYSTEM_PROMPT,
              prompt: userPrompt,
              temperature,
              maxOutputTokens: maxTokens,
            });
            call.recordSuccess({
              inputTokens: usage?.inputTokens ?? 0,
              outputTokens: usage?.outputTokens ?? 0,
              attempts: attempt,
              completion: JSON.stringify(object),
              extra: { 'verifier.verdict': object.verdict },
            });
            return object;
          } catch (err) {
            lastError = err;
            if (attempt === maxAttempts || !isRetryable(err)) {
              call.span.recordException(err);
              throw err;
            }
            // Exponential backoff: 500ms, 1000ms, 2000ms, ...
            const delay = baseDelayMs * 2 ** (attempt - 1);
            await sleep(delay);
          }
        }
        // Unreachable — the loop either returns or throws — but TS demands a
        // statement here.
        call.span.recordException(lastError);
        throw lastError;
      } finally {
        call.span.end();
      }
    },
  };
};

const escapeForXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
