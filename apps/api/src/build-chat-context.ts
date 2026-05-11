import {
  type ChatContext,
  type ConversationDispatcher,
  type ConversationRepository,
  type Researcher,
  type Synthesizer,
  type TurnRepository,
  type WikiReader,
  createAgenticResearcher,
  createAiSdkSynthesizer,
  createCfChatTurnDispatcher,
  createD1ConversationRepository,
  createD1TurnRepository,
  createDirectWikiReader,
  createDirectWikiResearcher,
  createInMemoryDispatcher,
  createMemorySourceHashVerifier,
  createOpenAiEmbedder,
  createVectorWikiReader,
} from '@domain/chat';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { Conversation as ConvWire, Turn as TurnWire } from '@package/contracts/chat';
import { userId } from '@package/contracts/shared';
import type { VectorizeIndex } from '@package/shared-kernel';
import { type EventBus, InMemoryEventBus, type Tracer, systemClock } from '@package/shared-kernel';
import type { LanguageModel } from 'ai';

/**
 * Default chat-context bindings for the api. With OPEN_ROUTER_API_KEY +
 * D1/R2 bindings present, we wire the real Researcher + Synthesizer
 * (Vercel AI SDK on top of OpenRouter) and a direct D1+R2 WikiReader so
 * the chat context never has to round-trip through oRPC for cross-context
 * lookups. Without the api key (e.g. unit tests), the stub adapters keep
 * the context constructable.
 *
 * `searchSources` has a fall-through chain (Stream O):
 *
 *   1. When BOTH the `VECTORIZE` binding and `OPENAI_EMBEDDING_API_KEY`
 *      are present, we wrap the D1 reader with a `VectorWikiReader` that
 *      embeds the query, hits the Vectorize index, and maps matches back
 *      to `Source` rows. Every other `WikiReader` method is a passthrough.
 *   2. If the embedder throws (missing key, rate limit, network) or the
 *      Vectorize query returns zero hits, the wrapper delegates to the
 *      inner reader's existing token-overlap implementation.
 *   3. When either binding is missing, the D1 reader is used directly —
 *      identical behavior to before Stream O shipped.
 *
 * Wiki pages themselves are NOT embedded — the fallback is source-level
 * semantic search only, per scope.
 */

type Conv = Parameters<ConversationRepository['insert']>[0];
type Trn = Parameters<TurnRepository['insert']>[0];

const inMemoryConversations = (): ConversationRepository => {
  const store = new Map<string, Conv>();
  return {
    async insert(c) {
      store.set(c.id, c);
    },
    async findById(id) {
      return store.get(id) ?? null;
    },
    async list({ wikiId, userId: uid, cursor, limit }) {
      const all = [...store.values()].filter((c) => {
        if (wikiId && c.wikiId !== wikiId) return false;
        if (uid && c.userId !== uid) return false;
        return true;
      });
      all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const start = cursor ? Number.parseInt(cursor, 10) : 0;
      const items = all.slice(start, start + limit);
      const nextCursor = start + limit < all.length ? String(start + limit) : undefined;
      return { items, ...(nextCursor !== undefined ? { nextCursor } : {}) };
    },
    toWire(c): ConvWire {
      return {
        id: c.id,
        wikiId: c.wikiId,
        userId: c.userId,
        ...(c.title !== undefined ? { title: c.title } : {}),
        createdAt: c.createdAt,
      };
    },
  };
};

const inMemoryTurns = (): TurnRepository => {
  const store = new Map<string, Trn>();
  return {
    async insert(t) {
      store.set(t.id, t);
    },
    async update(t) {
      store.set(t.id, t);
    },
    async findById(id) {
      return store.get(id) ?? null;
    },
    async list({ conversationId, cursor, limit }) {
      const all = [...store.values()]
        .filter((t) => t.conversationId === conversationId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const start = cursor ? Number.parseInt(cursor, 10) : 0;
      const items = all.slice(start, start + limit);
      const nextCursor = start + limit < all.length ? String(start + limit) : undefined;
      return { items, ...(nextCursor !== undefined ? { nextCursor } : {}) };
    },
    toWire(t): TurnWire {
      return {
        id: t.id,
        conversationId: t.conversationId,
        question: t.question,
        answer: [...t.answer],
        createdAt: t.createdAt,
        ...(t.finishedAt !== undefined ? { finishedAt: t.finishedAt } : {}),
      };
    },
  };
};

const emptyAsyncIterable = <T>(): AsyncIterable<T> => ({
  [Symbol.asyncIterator]: () => ({
    async next(): Promise<IteratorResult<T>> {
      return { value: undefined as unknown as T, done: true };
    },
  }),
});

const stubSynthesizer: Synthesizer = {
  stream() {
    // empty stream → use-case emits AnswerStarted then AnswerFinished.
    return emptyAsyncIterable();
  },
};

const stubWikiReader: WikiReader = {
  async searchPages() {
    return [];
  },
  async listSamplePages() {
    return [];
  },
  async getPage() {
    return null;
  },
  async searchSources() {
    return [];
  },
  async listPagesByType() {
    return [];
  },
  async getWikiMeta() {
    return null;
  },
};

export interface BuildChatContextOptions {
  /** Default user id used for the single-user demo. */
  currentUserId?: string;
  /**
   * Canonical cross-context bus. When the chat context shares a worker
   * process with the wiki context, pass the same `InMemoryEventBus` instance
   * so `AnswerProduced` flows into the wiki cross-context handlers. Defaults
   * to a fresh per-context bus (useful in unit tests).
   */
  eventBus?: EventBus;
  /** Optional D1 + R2 + OpenRouter bindings — when present we wire the real
   * Researcher/Synthesizer/WikiReader; without them the stubs keep the
   * context constructable. */
  bindings?: {
    db: D1Database;
    storage: R2Bucket;
    openRouterApiKey?: string;
    /**
     * Optional Cloudflare Vectorize index for the semantic-search
     * `searchSources` fallback. When present alongside
     * `openAiEmbeddingApiKey`, the chat context wraps the D1 reader with
     * a `VectorWikiReader` that embeds the query and ranks chunks via
     * cosine similarity. Missing either binding → unchanged behavior
     * (D1 token overlap).
     */
    vectorize?: VectorizeIndex;
    /**
     * OpenAI API key used by the embeddings adapter. Distinct from
     * `openRouterApiKey` — only the embedder talks to OpenAI directly;
     * the Researcher/Synthesizer route through OpenRouter to Anthropic.
     */
    openAiEmbeddingApiKey?: string;
  };
  /**
   * Cloudflare Durable Object namespace hosting the per-turn chat run.
   * When supplied, the dispatcher is a thin remote client to the DO so
   * `chat.ask` and `chat.streamAnswer` (separate HTTP requests that can
   * land on different isolates) share the tape. When omitted (tests, dev
   * without DO), the in-process `createInMemoryDispatcher` is used; that
   * one only works when both requests hit the same isolate.
   */
  chatTurnNamespace?: DurableObjectNamespace;
  /**
   * Optional Tracer. The Researcher / Synthesizer adapters take a tracer
   * directly so each LLM call wraps in an `llm.call` span. Defaults to no-op
   * for unit tests and any caller that doesn't care about traces.
   */
  tracer?: Tracer;
}

export const buildChatContext = (opts: BuildChatContextOptions = {}): ChatContext => {
  // Prefer D1-backed repos so conversations + turns survive wrangler reloads.
  // Falls back to in-memory only when no DB binding is present (unit tests).
  const conversations: ConversationRepository = opts.bindings
    ? createD1ConversationRepository(opts.bindings.db)
    : inMemoryConversations();
  const turns: TurnRepository = opts.bindings
    ? createD1TurnRepository(opts.bindings.db)
    : inMemoryTurns();
  // Source text reader: the source's extracted text is stored at R2 key
  // `sources/<id>/text` by the ingestion extractor and surfaced to the
  // browser via the `/__source/:id/text` endpoint. The citation verifier
  // re-hashes the slice that a Citation covers to confirm the source still
  // says what the wiki claims it says. Without this binding the verifier
  // would always fail with "source text not found" and every Citation would
  // tripwire — making the entire chat path unusable as soon as any citation
  // bound to a source is emitted.
  const sourceHashes = createMemorySourceHashVerifier({
    async readSourceText(sourceId) {
      if (!opts.bindings) return null;
      const obj = await opts.bindings.storage.get(`sources/${sourceId}/text`);
      return obj ? await obj.text() : null;
    },
    async sha256Hex(s) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
      const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
      return `sha256:${hex}`;
    },
  });
  const eventBus: EventBus = opts.eventBus ?? new InMemoryEventBus();

  let synthesizer: Synthesizer = stubSynthesizer;
  let wikiReader: WikiReader = stubWikiReader;
  let researcher: Researcher;
  let researcherName = 'wiki-search';
  let synthesizerName = 'stub-synthesizer';

  if (opts.bindings?.openRouterApiKey) {
    const { db, storage, openRouterApiKey, vectorize, openAiEmbeddingApiKey } = opts.bindings;
    const openrouter = createOpenRouter({ apiKey: openRouterApiKey });
    const baseReader = createDirectWikiReader(db, storage);
    // Compose-or-fallback: if both the Vectorize binding and an OpenAI
    // embedding key are present, wrap the base reader so `searchSources`
    // first tries semantic search and then falls through to token overlap.
    // Otherwise, hand the agent the base reader directly — preserving the
    // pre-Stream-O behavior bit-for-bit when either binding is missing.
    wikiReader =
      vectorize && openAiEmbeddingApiKey
        ? createVectorWikiReader({
            db,
            storage,
            vectorize,
            embedder: createOpenAiEmbedder({ apiKey: openAiEmbeddingApiKey }),
            inner: baseReader,
          })
        : baseReader;
    // Pin routing to Anthropic-direct. OpenRouter otherwise picks the
    // cheapest provider; Sonnet 4.6 falls back to Amazon Bedrock when
    // Anthropic itself is at capacity, and Bedrock's tool-call validator
    // diverges from Anthropic-direct on inputs the Synthesizer prompt is
    // tuned against. `allow_fallbacks: false` makes the failure mode loud
    // (a 400 from OpenRouter) instead of silently degrading.
    //
    // Cast: @openrouter/ai-sdk-provider@2.9 implements an older variant of
    // ai SDK's LanguageModelV2 that's missing the new `supportedUrls` field.
    // Verified compatible at runtime (verification context calls it the same
    // way). Drop the cast once the provider package catches up.
    const sonnet = openrouter.chat('anthropic/claude-sonnet-4.6', {
      provider: { order: ['anthropic'], allow_fallbacks: false },
    }) as LanguageModel;
    // Researcher AND synthesizer both run on Sonnet 4.6. Accuracy is the
    // hill we die on for this app — the wiki + indexed sources are the
    // moat, and the agent loop has to actually use them. A previous
    // Haiku-for-recall experiment showed the agent giving up after 2-3
    // searches on questions the wiki demonstrably covers; reverted.
    researcher = createAgenticResearcher({
      model: sonnet,
      wikiReader,
      modelName: 'anthropic/claude-sonnet-4.6',
      ...(opts.tracer ? { tracer: opts.tracer } : {}),
    });
    researcherName = 'agent-loop · anthropic/claude-sonnet-4.6';
    synthesizer = createAiSdkSynthesizer({
      model: sonnet,
      modelName: 'anthropic/claude-sonnet-4.6',
      ...(opts.tracer ? { tracer: opts.tracer } : {}),
    });
    synthesizerName = 'anthropic/claude-sonnet-4.6';
  } else {
    researcher = createDirectWikiResearcher({ wikiReader });
  }

  // Prefer the Durable Object dispatcher when bound. The DO survives the
  // `chat.ask` → `chat.streamAnswer` isolate hop on Cloudflare Workers;
  // the in-memory dispatcher only works when both requests happen to
  // land in the same isolate (true in some browser flows, false for
  // separate clients / curl probes / a worker scaling event). Tests and
  // local dev without a DO binding still get the in-memory version.
  const dispatcher: ConversationDispatcher = opts.chatTurnNamespace
    ? createCfChatTurnDispatcher(opts.chatTurnNamespace)
    : createInMemoryDispatcher({
        researcher,
        synthesizer,
        sourceHashes,
        conversations,
        turns,
        eventBus,
        wikiReader,
        now: () => new Date(),
        researcherName,
        synthesizerName,
      });

  return {
    clock: systemClock,
    researcher,
    synthesizer,
    sourceHashes,
    conversations,
    turns,
    dispatcher,
    eventBus,
    wikiReader,
    newId: () => crypto.randomUUID(),
    now: () => new Date(),
    currentUserId: userId(opts.currentUserId ?? '99999999-2222-4333-8444-555555555555'),
  };
};
