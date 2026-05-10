import {
  type ChatContext,
  type ConversationRepository,
  type Researcher,
  type Synthesizer,
  type TurnRepository,
  type WikiPageSummary,
  type WikiReader,
  createAiSdkResearcher,
  createAiSdkSynthesizer,
  createD1ConversationRepository,
  createD1TurnRepository,
  createInMemoryDispatcher,
  createMemorySourceHashVerifier,
} from '@domain/chat';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { Conversation as ConvWire, Turn as TurnWire } from '@package/contracts/chat';
import type {
  Citation,
  CitationId,
  ContentHash,
  SourceId,
  WikiId,
  WikiPageId,
} from '@package/contracts/shared';
import { userId } from '@package/contracts/shared';
import { type EventBus, InMemoryEventBus, systemClock } from '@package/shared-kernel';

/**
 * Default chat-context bindings for the api. With OPEN_ROUTER_API_KEY +
 * D1/R2 bindings present, we wire the real Researcher + Synthesizer
 * (Vercel AI SDK on top of OpenRouter) and a direct D1+R2 WikiReader so
 * the chat context never has to round-trip through oRPC for cross-context
 * lookups. Without the api key (e.g. unit tests), the stub adapters keep
 * the context constructable.
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

const stubResearcher: Researcher = {
  async research() {
    return { pages: [], findings: [] };
  },
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
  async getPage() {
    return null;
  },
};

interface PageRow {
  id: string;
  wiki_id: string;
  title: string;
  page_type: string | null;
  body_r2_key: string;
}

/**
 * Direct D1+R2 wiki reader. Avoids the cross-context oRPC round-trip
 * (which would re-enter the same Worker via `fetch` and complicate
 * subrequest counting) by reading wiki pages, citations, and page bodies
 * straight from the bindings the api already holds.
 *
 * Search is local: page through wiki_pages by wiki_id, hydrate body + cites,
 * rank by substring/token match. Good enough for demo wikis up to ~hundreds
 * of pages; a dedicated FTS index can replace this later.
 */
const createDirectWikiReader = (db: D1Database, storage: R2Bucket): WikiReader => {
  const tokenize = (s: string): string[] => s.toLowerCase().split(/\s+/).filter(Boolean);
  const score = (p: WikiPageSummary, q: string): number => {
    let s = 0;
    for (const t of tokenize(q)) {
      if (p.title.toLowerCase().includes(t)) s += 5;
      if (p.body.toLowerCase().includes(t)) s += 1;
    }
    return s;
  };

  const loadCitations = async (pageId: string): Promise<Citation[]> => {
    const rows = await db
      .prepare(
        'SELECT cit.id, cit.source_id, cit.byte_range_start, cit.byte_range_end, cit.content_hash, cit.label FROM citations cit JOIN claims cl ON cl.id = cit.claim_id WHERE cl.wiki_page_id = ?',
      )
      .bind(pageId)
      .all<{
        id: string;
        source_id: string;
        byte_range_start: number;
        byte_range_end: number;
        content_hash: string;
        label: string;
      }>();
    return rows.results.map((r) => ({
      id: r.id as CitationId,
      label: r.label,
      span: {
        sourceId: r.source_id as SourceId,
        byteRange: { start: r.byte_range_start, end: r.byte_range_end },
        contentHash: r.content_hash as ContentHash,
      },
    }));
  };

  const hydrate = async (row: PageRow): Promise<WikiPageSummary> => {
    const obj = await storage.get(row.body_r2_key);
    const body = obj ? await obj.text() : '';
    const citations = await loadCitations(row.id);
    return {
      id: row.id as WikiPageId,
      wikiId: row.wiki_id as WikiId,
      title: row.title,
      ...(row.page_type ? { pageType: row.page_type } : {}),
      body,
      citations,
    };
  };

  return {
    async searchPages({ wikiId, query, limit }) {
      const rows = await db
        .prepare(
          'SELECT id, wiki_id, title, page_type, body_r2_key FROM wiki_pages WHERE wiki_id = ? LIMIT 200',
        )
        .bind(wikiId)
        .all<PageRow>();
      const hydrated: WikiPageSummary[] = [];
      for (const r of rows.results) hydrated.push(await hydrate(r));
      return hydrated
        .map((p) => ({ p, s: score(p, query) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, limit)
        .map((x) => x.p);
    },
    async getPage(id) {
      const row = await db
        .prepare('SELECT id, wiki_id, title, page_type, body_r2_key FROM wiki_pages WHERE id = ?')
        .bind(id)
        .first<PageRow>();
      if (!row) return null;
      return hydrate(row);
    },
  };
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
  };
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
  const sourceHashes = createMemorySourceHashVerifier({
    async readSourceText() {
      return null;
    },
    async sha256Hex(s) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
      const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
      return `sha256:${hex}`;
    },
  });
  const eventBus: EventBus = opts.eventBus ?? new InMemoryEventBus();

  let researcher: Researcher = stubResearcher;
  let synthesizer: Synthesizer = stubSynthesizer;
  let wikiReader: WikiReader = stubWikiReader;

  if (opts.bindings?.openRouterApiKey) {
    const { db, storage, openRouterApiKey } = opts.bindings;
    const openrouter = createOpenRouter({ apiKey: openRouterApiKey });
    wikiReader = createDirectWikiReader(db, storage);
    researcher = createAiSdkResearcher({
      model: openrouter.chat('anthropic/claude-sonnet-4.6'),
      wikiReader,
    });
    synthesizer = createAiSdkSynthesizer({
      model: openrouter.chat('anthropic/claude-sonnet-4.6'),
      modelName: 'anthropic/claude-sonnet-4.6',
    });
  }

  const dispatcher = createInMemoryDispatcher({
    researcher,
    synthesizer,
    sourceHashes,
    conversations,
    turns,
    eventBus,
    wikiReader,
    now: () => new Date(),
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
