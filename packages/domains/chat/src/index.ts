export { chatRouter, type ChatContext } from './interface/index.ts';
export type {
  ChatDeps,
  ChatReadDeps,
  ChatRuntimeDeps,
  ChatWriteDeps,
  ConversationDispatcher,
  ConversationRepository,
  Researcher,
  ResearcherInput,
  ResearcherOutput,
  RawAnswerSegment,
  SourceHashVerifier,
  SourceSearchHit,
  Synthesizer,
  SynthesizerEvent,
  SynthesizerInput,
  TurnRepository,
  WikiMeta,
  WikiPageSummary,
  WikiReader,
} from './application/ports.ts';
export { CitationTripwireError } from './application/ports.ts';
export { ConversationNotFoundError, TurnNotFoundError } from './application/errors.ts';
export { createMemorySourceHashVerifier } from './application/verify-citation.ts';
export { createInMemoryDispatcher } from './infrastructure/in-memory-dispatcher.ts';
export { createAgenticResearcher } from './infrastructure/agentic-researcher.ts';
export { createDirectWikiResearcher } from './infrastructure/direct-wiki-researcher.ts';
export { createAiSdkSynthesizer } from './infrastructure/ai-sdk-synthesizer.ts';
export { createOrpcWikiReader } from './infrastructure/orpc-wiki-reader.ts';
export { createDirectWikiReader } from './infrastructure/d1-wiki-reader.ts';
export {
  createOpenAiEmbedder,
  EmbedderNotConfiguredError,
  type Embedder,
  type OpenAiEmbedderConfig,
} from './infrastructure/openai-embedder.ts';
export {
  createVectorWikiReader,
  type VectorWikiReader,
  type VectorWikiReaderDeps,
} from './infrastructure/vector-wiki-reader.ts';
export { createCfChatTurnDispatcher } from './infrastructure/cf-chat-turn-dispatcher.ts';
export { createChatTurnDOClass } from './infrastructure/durable_objects/chat-turn-do.ts';
export { runChatTurn, type RunChatTurnDeps } from './application/run-chat-turn.ts';
export {
  createD1ConversationRepository,
  type D1Like,
} from './infrastructure/d1-conversation-repo.ts';
export { createD1TurnRepository } from './infrastructure/d1-turn-repo.ts';
