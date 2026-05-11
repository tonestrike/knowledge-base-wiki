import {
  type Researcher,
  type RunChatTurnDeps,
  type Synthesizer,
  type WikiReader,
  createAgenticResearcher,
  createAiSdkSynthesizer,
  createD1ConversationRepository,
  createD1TurnRepository,
  createMemorySourceHashVerifier,
} from '@domain/chat';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { InMemoryEventBus } from '@package/shared-kernel';
import type { LanguageModel } from 'ai';
import { createDirectWikiReader } from './build-chat-context.ts';

export interface ChatTurnBindings extends Record<string, unknown> {
  DB: D1Database;
  STORAGE: R2Bucket;
  OPEN_ROUTER_API_KEY: string;
}

/**
 * Dep factory used inside the `ChatTurnDO`. Mirrors the Worker-side
 * `buildChatContext` runtime wiring, but produces only the slice the
 * `runChatTurn` loop needs: repos, agent + synth, source-text verifier,
 * wiki reader. No oRPC handler context — that lives in the Worker that
 * accepts `chat.ask` / `chat.streamAnswer`.
 *
 * Cross-context note: `eventBus` is a fresh `InMemoryEventBus` per DO
 * isolate. The `AnswerProduced` event published on `AnswerFinished` is
 * therefore visible only inside the DO — the wiki context's
 * AnswerProduced consumer (if/when wired) won't fire from a DO run. A
 * follow-up will route this back through a Worker fan-out endpoint or a
 * shared queue; tracking as a known gap below.
 *
 * KNOWN GAP — AnswerProduced cross-context event flow: see
 * docs/projects/0002-folder-wiki.md (cross-context events section).
 * For the demo, the chat answer is persisted on the Turn aggregate
 * (D1) so the UI never depends on AnswerProduced fanning out.
 */
export const buildChatTurnRuntimeDeps = (env: ChatTurnBindings): RunChatTurnDeps => {
  const wikiReader: WikiReader = createDirectWikiReader(env.DB, env.STORAGE);
  const openrouter = createOpenRouter({ apiKey: env.OPEN_ROUTER_API_KEY });
  const sonnet = openrouter.chat('anthropic/claude-sonnet-4.6', {
    provider: { order: ['anthropic'], allow_fallbacks: false },
  }) as LanguageModel;
  const researcher: Researcher = createAgenticResearcher({
    model: sonnet,
    wikiReader,
    modelName: 'anthropic/claude-sonnet-4.6',
  });
  const synthesizer: Synthesizer = createAiSdkSynthesizer({
    model: sonnet,
    modelName: 'anthropic/claude-sonnet-4.6',
  });
  const sourceHashes = createMemorySourceHashVerifier({
    async readSourceText(sourceId) {
      const obj = await env.STORAGE.get(`sources/${sourceId}/text`);
      return obj ? await obj.text() : null;
    },
    async sha256Hex(s) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
      const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
      return `sha256:${hex}`;
    },
  });
  return {
    researcher,
    synthesizer,
    sourceHashes,
    wikiReader,
    conversations: createD1ConversationRepository(env.DB),
    turns: createD1TurnRepository(env.DB),
    eventBus: new InMemoryEventBus(),
    now: () => new Date(),
    researcherName: 'agent-loop · anthropic/claude-sonnet-4.6',
    synthesizerName: 'anthropic/claude-sonnet-4.6',
  };
};
