import {
  type ChatContext,
  type ConversationDispatcher,
  type ConversationRepository,
  type Researcher,
  type SourceSearchHit,
  type Synthesizer,
  type TurnRepository,
  type WikiMeta,
  type WikiPageSummary,
  type WikiReader,
  createAgenticResearcher,
  createAiSdkSynthesizer,
  createCfChatTurnDispatcher,
  createD1ConversationRepository,
  createD1TurnRepository,
  createDirectWikiResearcher,
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
import type { LanguageModel } from 'ai';

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
export const createDirectWikiReader = (db: D1Database, storage: R2Bucket): WikiReader => {
  const tokenize = (s: string): string[] => s.toLowerCase().split(/\s+/).filter(Boolean);
  const score = (title: string, body: string, q: string): number => {
    let s = 0;
    const titleLower = title.toLowerCase();
    const bodyLower = body.toLowerCase();
    for (const t of tokenize(q)) {
      if (titleLower.includes(t)) s += 5;
      if (bodyLower.includes(t)) s += 1;
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
    // Bodies live at R2 key = page id. Both the canonical wiki writer
    // (`d1-wiki-page-repo.insertMany` → `storage.put(p.id, p.body)`) and
    // the dev seed endpoint write at this key, and the `body_r2_key`
    // column is kept consistent with it. Reading at `row.id` here matches
    // both writers; a previous version of this reader hit `row.body_r2_key`
    // expecting `wiki_pages/<id>.md`, which silently returned null bodies
    // because no writer ever used that prefix.
    const obj = await storage.get(row.id);
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

  // Per-search cache so N citations to the same source = 1 R2 round trip.
  // Scoped inside searchPages so different invocations don't poison each
  // other if a source is rewritten between calls.
  const expandWithSourceEvidence = async (
    page: WikiPageSummary,
    sourceTextCache: Map<SourceId, string | null>,
  ): Promise<string> => {
    // Cap on total expanded body so the synth prompt stays bounded even when
    // a page has many citations. We always include the original body; once
    // appended evidence pushes past `bodyCap`, remaining excerpts are skipped.
    const bodyCap = 8000;
    const perExcerptCap = 600;
    if (page.citations.length === 0) return page.body;
    let out = page.body;
    let appendedHeader = false;
    for (const cit of page.citations) {
      if (out.length >= bodyCap) break;
      const sid = cit.span.sourceId;
      let text = sourceTextCache.get(sid);
      if (text === undefined) {
        const obj = await storage.get(`sources/${sid}/text`);
        text = obj ? await obj.text() : null;
        sourceTextCache.set(sid, text);
      }
      if (!text) continue;
      const { start, end } = cit.span.byteRange;
      const slice = text.slice(start, end).trim();
      if (!slice) continue;
      const capped = slice.length > perExcerptCap ? `${slice.slice(0, perExcerptCap)}...` : slice;
      // Quote the slice line-by-line so internal newlines don't break the
      // markdown blockquote.
      const quoted = capped
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
      const sidShort = sid.slice(0, 8);
      if (!appendedHeader) {
        out += '\n\n---\n## Cited evidence\n';
        appendedHeader = true;
      }
      out += `\n### [${cit.label}] (${sidShort})\n${quoted}\n`;
    }
    return out;
  };

  return {
    async searchPages({ wikiId, query, limit }) {
      // Exclude Index pages from chat search. Index pages are typed
      // tables of contents — they list entries that link to the real
      // Concept pages, carry zero citations, and burn agent-loop budget
      // when the model keeps drilling into them looking for substance.
      // Browser-probe trace showed ~15s of dead air per question while
      // the agent re-read "Papers" / "Techniques" indexes. The wiki tree
      // sidebar still surfaces them; chat just won't.
      const rows = await db
        .prepare(
          "SELECT id, wiki_id, title, page_type, body_r2_key FROM wiki_pages WHERE wiki_id = ? AND subtype != 'Index' LIMIT 200",
        )
        .bind(wikiId)
        .all<PageRow>();
      const hydrated: WikiPageSummary[] = [];
      for (const r of rows.results) hydrated.push(await hydrate(r));
      const ranked = hydrated
        // Score against the ORIGINAL page body — expansion is for the synth
        // only and shouldn't tilt search ranking toward pages whose source
        // excerpts happen to contain query tokens.
        .map((p) => ({ p, s: score(p.title, p.body, query) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, limit);
      const sourceTextCache = new Map<SourceId, string | null>();
      const expanded: WikiPageSummary[] = [];
      for (const { p } of ranked) {
        const body = await expandWithSourceEvidence(p, sourceTextCache);
        expanded.push({ ...p, body });
      }
      return expanded;
    },
    async listSamplePages({ wikiId, limit }) {
      // No score / query — just return the first `limit` pages from the
      // wiki. Used as a fallback for the empty-findings synthesizer
      // branch so the agent has real grounded context to compose
      // guidance instead of hand-rolling a "no results" string. We
      // inline `limit` (validated as a positive int by the caller in
      // researchQuestion) because some D1 builds reject parameter
      // binding inside LIMIT clauses.
      const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
      const rows = await db
        .prepare(
          `SELECT id, wiki_id, title, page_type, body_r2_key FROM wiki_pages WHERE wiki_id = ? LIMIT ${safeLimit}`,
        )
        .bind(wikiId)
        .all<PageRow>();
      const out: WikiPageSummary[] = [];
      for (const r of rows.results) out.push(await hydrate(r));
      return out;
    },
    async getPage(id) {
      const row = await db
        .prepare('SELECT id, wiki_id, title, page_type, body_r2_key FROM wiki_pages WHERE id = ?')
        .bind(id)
        .first<PageRow>();
      if (!row) return null;
      return hydrate(row);
    },
    async listPagesByType({ wikiId, pageType, limit }) {
      // Browse-by-section: enumerate Concept pages whose pageType column
      // matches. Lets the agent answer "what's in the Opportunity
      // section?" without keyword-guessing. Index pages excluded — they
      // are tables of contents, not content. limit is inlined because
      // some D1 builds reject bindings inside LIMIT clauses.
      const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
      const rows = await db
        .prepare(
          `SELECT id, wiki_id, title, page_type, body_r2_key FROM wiki_pages
           WHERE wiki_id = ? AND page_type = ? AND subtype != 'Index'
           ORDER BY title ASC LIMIT ${safeLimit}`,
        )
        .bind(wikiId, pageType)
        .all<PageRow>();
      const out: WikiPageSummary[] = [];
      for (const r of rows.results) out.push(await hydrate(r));
      return out;
    },
    async getWikiMeta(wikiId) {
      const row = await db
        .prepare('SELECT folder_id, schema_json, perspective FROM wikis WHERE id = ?')
        .bind(wikiId)
        .first<{ folder_id: string; schema_json: string; perspective: string | null }>();
      if (!row) return null;
      let pageTypes: WikiMeta['pageTypes'] = [];
      try {
        const parsed = JSON.parse(row.schema_json) as {
          pageTypes?: ReadonlyArray<{ name: string; description: string }>;
        };
        pageTypes = parsed.pageTypes ?? [];
      } catch {
        // Malformed schema_json shouldn't crash the agent's research loop —
        // surface an empty pageTypes list instead and let the agent fall
        // back to keyword search.
        pageTypes = [];
      }
      // The folder table lives in the ingestion context; reading its
      // `name` column directly is the simplest cross-binding path
      // available here. Best-effort — null when the folder row is gone.
      let folderName: string | undefined;
      try {
        const folderRow = await db
          .prepare('SELECT name FROM folders WHERE id = ?')
          .bind(row.folder_id)
          .first<{ name: string }>();
        if (folderRow?.name) folderName = folderRow.name;
      } catch {
        folderName = undefined;
      }
      return {
        wikiId,
        pageTypes,
        ...(row.perspective ? { perspective: row.perspective } : {}),
        ...(folderName ? { folderName } : {}),
      };
    },
    async searchSources({ wikiId, query, limit }) {
      // Discovery fallback: searchPages matches on page title + body
      // tokens, but a user phrasing like "deceptive AI behavior" can miss
      // pages whose compiled body uses domain vocabulary like "alignment
      // faking" while the underlying PDF text says both. We read the raw
      // source text for every Source cited anywhere in this wiki, score
      // by token overlap, and hand the agent back the top hits with
      // their citing pages so it can drill into real WikiPages via
      // readWikiPage. New citations are NEVER minted from raw matches
      // — the synth grounds against page citations only, keeping the
      // fabrication tripwire intact.
      const qTokens = [...new Set(tokenize(query))].filter((t) => t.length >= 3);
      if (qTokens.length === 0) return [];

      const rows = await db
        .prepare(
          `SELECT DISTINCT cit.source_id AS source_id, cit.content_hash AS content_hash
             FROM citations cit
             JOIN claims cl ON cl.id = cit.claim_id
             JOIN wiki_pages p ON p.id = cl.wiki_page_id
            WHERE p.wiki_id = ?
            LIMIT 60`,
        )
        .bind(wikiId)
        .all<{ source_id: string; content_hash: string }>();
      if (rows.results.length === 0) return [];

      // Citing-pages index: one batched query then group by source.
      const citingRows = await db
        .prepare(
          `SELECT DISTINCT cit.source_id AS source_id, p.id AS page_id, p.title AS title, p.page_type AS page_type
             FROM citations cit
             JOIN claims cl ON cl.id = cit.claim_id
             JOIN wiki_pages p ON p.id = cl.wiki_page_id
            WHERE p.wiki_id = ? AND p.subtype != 'Index'`,
        )
        .bind(wikiId)
        .all<{ source_id: string; page_id: string; title: string; page_type: string | null }>();
      const citingBySource = new Map<string, SourceSearchHit['citingPages']>();
      for (const r of citingRows.results) {
        const list = citingBySource.get(r.source_id) ?? [];
        list.push({
          pageId: r.page_id as WikiPageId,
          title: r.title,
          ...(r.page_type ? { pageType: r.page_type } : {}),
        });
        citingBySource.set(r.source_id, list);
      }

      const scored: Array<{ hit: SourceSearchHit; score: number }> = [];
      for (const row of rows.results) {
        const obj = await storage.get(`sources/${row.source_id}/text`);
        if (!obj) continue;
        const text = await obj.text();
        const textLower = text.toLowerCase();
        let score = 0;
        for (const t of qTokens) {
          let i = textLower.indexOf(t);
          while (i !== -1) {
            score += 1;
            i = textLower.indexOf(t, i + t.length);
          }
        }
        if (score === 0) continue;
        // Find the best window: pick the first occurrence of the rarest
        // query token, centre an excerpt around it. Good enough — we
        // don't need a true span-density window for a demo.
        let anchor = -1;
        for (const t of qTokens) {
          const at = textLower.indexOf(t);
          if (at >= 0) {
            anchor = at;
            break;
          }
        }
        const excerptCenter = anchor >= 0 ? anchor : 0;
        const excerptStart = Math.max(0, excerptCenter - 120);
        const excerptEnd = Math.min(text.length, excerptCenter + 280);
        const excerpt = text.slice(excerptStart, excerptEnd).trim();
        scored.push({
          score,
          hit: {
            sourceId: row.source_id as SourceId,
            excerpt,
            byteRange: { start: excerptStart, end: excerptEnd },
            contentHash: row.content_hash as ContentHash,
            citingPages: citingBySource.get(row.source_id) ?? [],
          },
        });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, Math.max(1, limit)).map((s) => s.hit);
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
  /**
   * Cloudflare Durable Object namespace hosting the per-turn chat run.
   * When supplied, the dispatcher is a thin remote client to the DO so
   * `chat.ask` and `chat.streamAnswer` (separate HTTP requests that can
   * land on different isolates) share the tape. When omitted (tests, dev
   * without DO), the in-process `createInMemoryDispatcher` is used; that
   * one only works when both requests hit the same isolate.
   */
  chatTurnNamespace?: DurableObjectNamespace;
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
    const { db, storage, openRouterApiKey } = opts.bindings;
    const openrouter = createOpenRouter({ apiKey: openRouterApiKey });
    wikiReader = createDirectWikiReader(db, storage);
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
    });
    researcherName = 'agent-loop · anthropic/claude-sonnet-4.6';
    synthesizer = createAiSdkSynthesizer({
      model: sonnet,
      modelName: 'anthropic/claude-sonnet-4.6',
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
