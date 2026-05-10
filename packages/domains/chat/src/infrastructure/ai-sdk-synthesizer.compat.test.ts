import { describe, expect, it } from 'bun:test';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createAiSdkSynthesizer } from './ai-sdk-synthesizer.ts';

// CR-18: pin the runtime/type compatibility between `ai@^4` and
// `@openrouter/ai-sdk-provider@^0.7`. The peer-version skew the code-reviewer
// flagged was: `ai@4` ships `@ai-sdk/provider@1.x` while older
// `@openrouter/ai-sdk-provider@0.0.x` pinned `@ai-sdk/provider@0.0.26`.
// `0.7.2+` aligns on `@ai-sdk/provider@1.x` so the model object satisfies
// `LanguageModelV1`.
//
// The test never makes a network call; it just constructs the provider, picks
// a model, and verifies that the resulting object can be passed into
// `createAiSdkSynthesizer` without a TypeScript or runtime error.

describe('ai-sdk-synthesizer ↔ openrouter peer-version compatibility (CR-18)', () => {
  it('createOpenRouter().chat(modelId) is assignable to LanguageModelV1', () => {
    const openrouter = createOpenRouter({ apiKey: 'sk-or-placeholder-not-used' });
    const model = openrouter.chat('anthropic/claude-sonnet-4.6');
    // Construction alone exercises the type contract: if `ai`'s
    // `LanguageModelV1` and the provider's returned shape ever drift,
    // this line stops compiling.
    const synth = createAiSdkSynthesizer({
      model,
      modelName: 'anthropic/claude-sonnet-4.6',
    });
    expect(typeof synth.stream).toBe('function');
  });
});
