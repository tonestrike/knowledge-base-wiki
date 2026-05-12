/**
 * Vectorize-backed `WikiReader` adapter. Wraps the existing token-overlap
 * reader and short-circuits BOTH `searchSources` AND `searchPages` (the
 * agent's `searchWiki` tool) through a semantic-search path:
 *
 *   1. Embed the query via `openai/text-embedding-3-small` (1536-dim, via
 *      OpenRouter — see `openrouter-embedder.ts`).
 *   2. Hit Cloudflare Vectorize (`tenex-sources` index, cosine metric)
 *      with the appropriate kind filter (`source` for sources, `page`
 *      for wiki pages).
 *   3. Map the returned ids back to D1 rows + R2 bodies to mint the
 *      same `SourceSearchHit` / `WikiPageSummary` shapes the agent loop
 *      already consumes.
 *
 * Compose-or-fallback: if the embedder errors (missing key, network
 * fail, etc.) OR the Vectorize index returns zero matches, the wrapper
 * delegates to the inner reader's existing token-overlap implementation.
 * Every other `WikiReader` method (`getPage`, `listPagesByType`, …) is
 * a straight passthrough.
 *
 * The `indexSource` / `indexWikiPage` methods are the write path: they
 * embed and upsert into Vectorize keyed by stable ids
 * (`source:<sourceId>:<chunkIndex>` and `page:<wikiPageId>`) so re-indexing
 * is idempotent. Auto-indexing is wired through the event bus in
 * `index-on-events.ts` — when a `CompileFinished` event fires, every
 * source + page in the affected wiki gets re-embedded best-effort.
 */

import type { ContentHash, SourceId, WikiId, WikiPageId } from '@package/contracts/shared';
import type { SourceSearchHit, WikiPageSummary, WikiReader } from '../application/ports.ts';
import type { D1Database, R2Bucket, VectorizeIndex } from './cf-types.ts';
import type { Embedder } from './openrouter-embedder.ts';

interface SourceRow {
  source_id: string;
  content_hash: string;
}

interface CitingPageRow {
  source_id: string;
  page_id: string;
  title: string;
  page_type: string | null;
}

/** Vectorize metadata for a source-text chunk. `kind` discriminates
 *  source chunks from wiki-page records that share the same index. */
interface SourceChunkMetadata {
  kind: 'source';
  sourceId: string;
  wikiId: string;
  chunkStart: number;
  chunkEnd: number;
  hash: string;
}

/** Vectorize metadata for a whole wiki page. We embed the title + body
 *  in one shot (pages are 500-2k chars post-compile) and store enough
 *  context to filter by `wikiId` + `pageType` at query time. */
interface PageMetadata {
  kind: 'page';
  wikiPageId: string;
  wikiId: string;
  pageType?: string;
  slug: string;
}

type ChunkMetadata = SourceChunkMetadata | PageMetadata;

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
// Vectorize caps a single upsert call at 1000 vectors; OpenAI's
// embeddings endpoint caps at 100 inputs per request. The smaller cap
// dominates.
const EMBED_BATCH = 100;

const chunkText = (text: string): ReadonlyArray<{ start: number; end: number; body: string }> => {
  const out: Array<{ start: number; end: number; body: string }> = [];
  if (text.length === 0) return out;
  const step = CHUNK_SIZE - CHUNK_OVERLAP;
  for (let start = 0; start < text.length; start += step) {
    const end = Math.min(text.length, start + CHUNK_SIZE);
    const body = text.slice(start, end);
    if (body.trim().length > 0) {
      out.push({ start, end, body });
    }
    if (end >= text.length) break;
  }
  return out;
};

/** Stable id for a source chunk. The legacy form `<sourceId>::<chunkStart>`
 *  is replaced with `source:<sourceId>:<chunkStart>` so the `kind` is
 *  inferable from the id alone (helps debugging the index from
 *  `wrangler vectorize get-by-ids`). */
const sourceChunkId = (sourceId: string, chunkStart: number): string =>
  `source:${sourceId}:${chunkStart}`;

const pageRecordId = (wikiPageId: string): string => `page:${wikiPageId}`;

export interface VectorWikiReaderDeps {
  db: D1Database;
  storage: R2Bucket;
  vectorize: VectorizeIndex;
  embedder: Embedder;
  inner: WikiReader;
}

export interface IndexedPage {
  id: WikiPageId;
  wikiId: WikiId;
  title: string;
  body: string;
  pageType?: string;
  slug: string;
}

export interface VectorWikiReader extends WikiReader {
  /**
   * Embed + upsert every chunk of a source's extracted text into the
   * Vectorize index. Idempotent: chunk ids are deterministic
   * (`source:<sourceId>:<chunkStart>`) so a re-index overwrites in
   * place. The `wikiId` is stamped onto each chunk's metadata so the
   * query path can filter to "sources cited by *this* wiki".
   */
  indexSource(args: {
    wikiId: WikiId;
    sourceId: SourceId;
    contentHash: ContentHash;
    text: string;
  }): Promise<{ chunks: number }>;
  /**
   * Embed + upsert one whole wiki page as a single vector. Wiki pages
   * are small post-compile (500-2k chars) — we don't chunk; the title
   * is concatenated to the body so it influences the embedding without
   * the agent having to query for it. Stable id: `page:<wikiPageId>`.
   */
  indexWikiPage(page: IndexedPage): Promise<{ indexed: boolean }>;
}

export const createVectorWikiReader = (deps: VectorWikiReaderDeps): VectorWikiReader => {
  const { db, storage, vectorize, embedder, inner } = deps;

  // --- query-path helpers ------------------------------------------------

  const loadAllowedSources = async (
    wikiId: WikiId,
  ): Promise<Map<string, { contentHash: string }>> => {
    const rows = await db
      .prepare(
        `SELECT DISTINCT cit.source_id AS source_id, cit.content_hash AS content_hash
           FROM citations cit
           JOIN claims cl ON cl.id = cit.claim_id
           JOIN wiki_pages p ON p.id = cl.wiki_page_id
          WHERE p.wiki_id = ?`,
      )
      .bind(wikiId)
      .all<SourceRow>();
    const out = new Map<string, { contentHash: string }>();
    for (const r of rows.results) {
      out.set(r.source_id, { contentHash: r.content_hash });
    }
    return out;
  };

  const loadCitingPages = async (
    wikiId: WikiId,
  ): Promise<Map<string, SourceSearchHit['citingPages']>> => {
    const rows = await db
      .prepare(
        `SELECT DISTINCT cit.source_id AS source_id, p.id AS page_id, p.title AS title, p.page_type AS page_type
           FROM citations cit
           JOIN claims cl ON cl.id = cit.claim_id
           JOIN wiki_pages p ON p.id = cl.wiki_page_id
          WHERE p.wiki_id = ? AND p.subtype != 'Index'`,
      )
      .bind(wikiId)
      .all<CitingPageRow>();
    const map = new Map<string, SourceSearchHit['citingPages']>();
    for (const r of rows.results) {
      const list = map.get(r.source_id) ?? [];
      list.push({
        pageId: r.page_id as WikiPageId,
        title: r.title,
        ...(r.page_type ? { pageType: r.page_type } : {}),
      });
      map.set(r.source_id, list);
    }
    return map;
  };

  const sliceExcerpt = (text: string, start: number, end: number): string => {
    return text.slice(start, end).trim();
  };

  return {
    /**
     * Semantic-search override for the agent's `searchWiki` tool. Embeds
     * the query, hits Vectorize filtered to `kind === 'page'` records of
     * this `wikiId`, hydrates the top matches via the inner reader's
     * `getPage` (so the agent gets the same shape — body + citations —
     * it would from the D1 path). Falls through to inner.searchPages on
     * embedder/Vectorize errors or zero hits.
     */
    async searchPages(args) {
      const { wikiId, query, limit } = args;
      const trimmed = query.trim();
      if (trimmed.length === 0) return inner.searchPages(args);

      let queryVector: readonly number[] | null = null;
      try {
        const vectors = await embedder.embed([trimmed]);
        queryVector = vectors[0] ?? null;
      } catch {
        return inner.searchPages(args);
      }
      if (!queryVector) return inner.searchPages(args);

      let matches: ReadonlyArray<{ id: string; metadata?: Record<string, unknown> }>;
      try {
        const result = await vectorize.query(queryVector, {
          topK: Math.max(limit * 4, 20),
          returnMetadata: 'all',
        });
        matches = result.matches;
      } catch {
        return inner.searchPages(args);
      }
      if (matches.length === 0) return inner.searchPages(args);

      const seen = new Set<string>();
      const hits: WikiPageSummary[] = [];
      for (const m of matches) {
        if (hits.length >= limit) break;
        const meta = (m.metadata ?? {}) as Partial<PageMetadata>;
        if (meta.kind !== 'page') continue;
        if (!meta.wikiPageId) continue;
        if (meta.wikiId && meta.wikiId !== wikiId) continue;
        if (seen.has(meta.wikiPageId)) continue;
        const page = await inner.getPage(meta.wikiPageId as WikiPageId);
        if (!page) continue;
        seen.add(meta.wikiPageId);
        hits.push(page);
      }
      if (hits.length === 0) return inner.searchPages(args);
      return hits;
    },
    async listSamplePages(args) {
      return inner.listSamplePages(args);
    },
    async getPage(id): Promise<WikiPageSummary | null> {
      return inner.getPage(id);
    },
    async listPagesByType(args) {
      return inner.listPagesByType(args);
    },
    async getWikiMeta(wikiId) {
      return inner.getWikiMeta(wikiId);
    },

    async searchSources(args) {
      const { wikiId, query, limit } = args;
      const trimmed = query.trim();
      if (trimmed.length === 0) return inner.searchSources(args);

      // 1) embed the query — fall through to token overlap on any
      //    embedder error (missing key, rate limit, network blip).
      let queryVector: readonly number[] | null = null;
      try {
        const vectors = await embedder.embed([trimmed]);
        queryVector = vectors[0] ?? null;
      } catch {
        return inner.searchSources(args);
      }
      if (!queryVector) return inner.searchSources(args);

      // 2) hit Vectorize.
      let matches: ReadonlyArray<{ id: string; metadata?: Record<string, unknown> }>;
      try {
        const result = await vectorize.query(queryVector, {
          topK: Math.max(limit * 4, 20),
          returnMetadata: 'all',
        });
        matches = result.matches;
      } catch {
        return inner.searchSources(args);
      }
      if (matches.length === 0) return inner.searchSources(args);

      // 3) filter to sources actually cited by this wiki (Vectorize is
      //    a single shared index across wikis; we constrain at query
      //    time via the citations join rather than relying on a
      //    metadata filter).
      const [allowed, citingBySource] = await Promise.all([
        loadAllowedSources(wikiId),
        loadCitingPages(wikiId),
      ]);

      const sourceTextCache = new Map<string, string | null>();
      const seen = new Set<string>();
      const hits: SourceSearchHit[] = [];
      for (const m of matches) {
        if (hits.length >= limit) break;
        const rawMeta = (m.metadata ?? {}) as Partial<ChunkMetadata>;
        // Skip page records — this is the source-search path.
        if (rawMeta.kind === 'page') continue;
        const meta = rawMeta as Partial<SourceChunkMetadata>;
        const sid = meta.sourceId;
        if (!sid) continue;
        if (seen.has(sid)) continue;
        const row = allowed.get(sid);
        if (!row) continue;
        if (meta.wikiId && meta.wikiId !== wikiId) {
          // Chunk was indexed under a different wiki; skip even though
          // D1 says this source is cited here too.
          continue;
        }
        let text = sourceTextCache.get(sid);
        if (text === undefined) {
          const obj = await storage.get(`sources/${sid}/text`);
          text = obj ? await obj.text() : null;
          sourceTextCache.set(sid, text);
        }
        if (!text) continue;
        const start = typeof meta.chunkStart === 'number' ? meta.chunkStart : 0;
        const end =
          typeof meta.chunkEnd === 'number'
            ? meta.chunkEnd
            : Math.min(text.length, start + CHUNK_SIZE);
        const excerpt = sliceExcerpt(text, start, end);
        if (!excerpt) continue;
        seen.add(sid);
        hits.push({
          sourceId: sid as SourceId,
          excerpt,
          byteRange: { start, end },
          contentHash: row.contentHash as ContentHash,
          citingPages: citingBySource.get(sid) ?? [],
        });
      }
      if (hits.length === 0) return inner.searchSources(args);
      return hits;
    },

    async indexSource({ wikiId, sourceId, contentHash, text }) {
      const chunks = chunkText(text);
      if (chunks.length === 0) return { chunks: 0 };
      for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
        const slice = chunks.slice(i, i + EMBED_BATCH);
        const vectors = await embedder.embed(slice.map((c) => c.body));
        const upserts = slice.map((c, idx) => {
          const v = vectors[idx];
          if (!v) {
            throw new Error(
              `vector-wiki-reader: missing vector for chunk ${i + idx} of source ${sourceId}`,
            );
          }
          const meta: SourceChunkMetadata = {
            kind: 'source',
            sourceId,
            wikiId,
            chunkStart: c.start,
            chunkEnd: c.end,
            hash: contentHash,
          };
          return {
            id: sourceChunkId(sourceId, c.start),
            values: [...v],
            metadata: meta as unknown as Record<string, unknown>,
          };
        });
        await vectorize.upsert(upserts);
      }
      return { chunks: chunks.length };
    },

    async indexWikiPage(page) {
      // Wiki pages are already a compiled, magazine-style summary —
      // typically 500-2k chars. Embed title + body as one input so the
      // page's name influences ranking (matters for short questions
      // like "alignment faking" where the title carries the term but
      // the body uses surrounding context).
      const text = `${page.title}\n\n${page.body}`.trim();
      if (text.length === 0) return { indexed: false };
      const vectors = await embedder.embed([text]);
      const v = vectors[0];
      if (!v) {
        throw new Error(`vector-wiki-reader: missing vector for page ${page.id}`);
      }
      const meta: PageMetadata = {
        kind: 'page',
        wikiPageId: page.id,
        wikiId: page.wikiId,
        ...(page.pageType ? { pageType: page.pageType } : {}),
        slug: page.slug,
      };
      await vectorize.upsert([
        {
          id: pageRecordId(page.id),
          values: [...v],
          metadata: meta as unknown as Record<string, unknown>,
        },
      ]);
      return { indexed: true };
    },
  };
};
