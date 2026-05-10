import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateObject } from 'ai';
import type { z } from 'zod';
import type { LlmClient } from '../application/ports.ts';

export interface LlmClientConfig {
  apiKey: string;
  // Optional metadata so OpenRouter ranks our requests; safe to omit.
  appName?: string;
  appUrl?: string;
}

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
    },
  };
};
