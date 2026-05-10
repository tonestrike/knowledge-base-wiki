export { chatRouter, type ChatContext } from './interface/index.ts';
export type {
  ChatDeps,
  ConversationDispatcher,
  ConversationRepository,
  EventBus,
  Researcher,
  ResearcherInput,
  ResearcherOutput,
  RawAnswerSegment,
  SourceHashVerifier,
  Synthesizer,
  SynthesizerEvent,
  SynthesizerInput,
  TurnRepository,
  WikiPageSummary,
  WikiReader,
} from './application/ports.ts';
export { createMemorySourceHashVerifier } from './application/verify-citation.ts';
export { createInMemoryDispatcher } from './infrastructure/in-memory-dispatcher.ts';
export { createAiSdkResearcher } from './infrastructure/ai-sdk-researcher.ts';
export { createAiSdkSynthesizer } from './infrastructure/ai-sdk-synthesizer.ts';
export { createOrpcWikiReader } from './infrastructure/orpc-wiki-reader.ts';
export {
  createD1ConversationRepository,
  type D1Like,
} from './infrastructure/d1-conversation-repo.ts';
export { createD1TurnRepository } from './infrastructure/d1-turn-repo.ts';
