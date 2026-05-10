import { createOpenRouter } from '@openrouter/ai-sdk-provider';
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
}

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

  return {
    async audit({ claim, citedSlices }) {
      const slicesXml = citedSlices
        .map((s) => `<slice citationId="${s.citationId}">\n${escapeForXml(s.sliceText)}\n</slice>`)
        .join('\n');
      const userPrompt = `Claim:\n${claim.claimText}\n\nCited slices:\n${slicesXml}`;

      const { object } = await generateObject({
        model: provider.chat(modelId),
        schema: VerdictSchema,
        schemaName: 'Verdict',
        schemaDescription: 'Verifier verdict for a single Claim against its cited Spans.',
        system: SYSTEM_PROMPT,
        prompt: userPrompt,
        temperature,
        maxOutputTokens: maxTokens,
      });

      return object;
    },
  };
};

const escapeForXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
