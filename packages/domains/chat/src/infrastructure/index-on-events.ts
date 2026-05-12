/**
 * Auto-indexing subscriber: wires the chat `VectorWikiReader` into the
 * cross-context `EventBus` so a fresh wiki compile populates Vectorize
 * without the operator having to POST anything.
 *
 * We hook a single event: `CompileFinished`. The wiki context emits this
 * once per CompileRun with `{ compileRunId, wikiId, finishedAt, pageCount
 * }`. On receipt we walk the wiki — every page + every cited source —
 * and call the reader's `indexSource` / `indexWikiPage` methods. This is
 * the only event that carries a `wikiId`; `SourceIngested` fires at
 * Drive-ingestion time when no wiki exists yet, so it can't be the
 * trigger.
 *
 * Indexing is best-effort and explicitly NOT in the critical path of the
 * compile:
 *   - Errors are caught + logged so a partial Vectorize state never blocks
 *     the chat path; the reader can still use D1/R2 keyword-overlap search
 *     for any missing entries.
 *   - The whole walk is fired-and-forgotten via the optional `waitUntil`
 *     so the Worker's response flush doesn't strand the HTTP fetches mid-
 *     batch.
 *
 * Singleton-by-design at the composition root: `subscribeIndexing` is
 * called once per Worker isolate (see `apps/api/src/build-chat-context.ts`).
 * The returned unsubscribe function is unused in production — the
 * subscription's lifetime equals the isolate's.
 */

import type { ContentHash, SourceId, WikiId, WikiPageId } from '@package/contracts/shared';
import type { EventBus, Unsubscribe } from '@package/shared-kernel';
import type { D1Database, R2Bucket } from './cf-types.ts';
import type { IndexedPage, VectorWikiReader } from './vector-wiki-reader.ts';

export interface IndexingDeps {
  vectorReader: VectorWikiReader;
  /** Read access to D1 + R2 — we use these to enumerate pages + sources
   *  for the affected wiki on a `CompileFinished` event. */
  db: D1Database;
  storage: R2Bucket;
  /** Optional Cloudflare `ExecutionContext.waitUntil` shim. When supplied
   *  we anchor the indexing fan-out so the Worker doesn't abort the
   *  embedding fetches at response flush. */
  waitUntil?: (p: Promise<unknown>) => void;
}

/**
 * Subscribe the chat context's auto-indexer to a shared `EventBus`.
 * Idempotent at the caller (the composition root tracks a "did we wire
 * this isolate?" flag); each call yields a fresh `Unsubscribe`.
 */
export const subscribeIndexing = (bus: EventBus, deps: IndexingDeps): Unsubscribe => {
  const off = bus.subscribe('CompileFinished', async (event) => {
    const wikiId = event.payload.wikiId as WikiId;
    const work = indexWiki(deps, wikiId).catch((err) => {
      // Indexing must NEVER block the compile path. Log and move on; the
      // VectorWikiReader's fall-through handles missing entries the next
      // time the agent queries.
      console.error(
        '[chat.index-on-events] indexWiki failed wikiId=%s err=%s',
        wikiId,
        err instanceof Error ? err.message : err,
      );
    });
    if (deps.waitUntil) {
      deps.waitUntil(work);
    } else {
      // Outside Workers (tests, local node) we want to await so callers
      // can assert on the side-effect.
      await work;
    }
  });
  return off;
};

interface PageRow {
  id: string;
  wiki_id: string;
  title: string;
  page_type: string | null;
  slug: string;
}

interface SourceRow {
  source_id: string;
  content_hash: string;
}

/**
 * Walk every page + every cited source in the wiki and re-embed them.
 * Returns a summary suitable for logging or returning from the admin
 * backfill endpoint. Used both by the auto-subscriber and by
 * `/__admin/reindex-wiki/:wikiId` so the indexing logic stays in one
 * place.
 */
export const indexWiki = async (
  deps: IndexingDeps,
  wikiId: WikiId,
): Promise<{
  wikiId: WikiId;
  sourcesIndexed: number;
  sourcesSkipped: number;
  pagesIndexed: number;
  pagesSkipped: number;
  errors: Array<{ kind: 'page' | 'source'; id: string; message: string }>;
}> => {
  const { db, storage, vectorReader } = deps;
  const errors: Array<{ kind: 'page' | 'source'; id: string; message: string }> = [];

  // --- 1. Index every wiki page ------------------------------------------
  const pageRows = await db
    .prepare(
      'SELECT id, wiki_id, title, page_type, slug FROM wiki_pages WHERE wiki_id = ? LIMIT 500',
    )
    .bind(wikiId)
    .all<PageRow>();

  let pagesIndexed = 0;
  let pagesSkipped = 0;
  for (const row of pageRows.results) {
    try {
      // Canonical body location is `wiki_pages/<id>.md` (see
      // `r2-wiki-page-storage.ts`). The legacy `__seed/wiki` endpoint
      // writes under bare `id`; fall through to that key if the
      // canonical lookup misses so the featured seed wiki still indexes.
      const obj = (await storage.get(`wiki_pages/${row.id}.md`)) ?? (await storage.get(row.id));
      const body = obj ? await obj.text() : '';
      if (!body.trim()) {
        pagesSkipped += 1;
        continue;
      }
      const indexed: IndexedPage = {
        id: row.id as WikiPageId,
        wikiId: row.wiki_id as WikiId,
        title: row.title,
        body,
        ...(row.page_type ? { pageType: row.page_type } : {}),
        slug: row.slug,
      };
      const out = await vectorReader.indexWikiPage(indexed);
      if (out.indexed) {
        pagesIndexed += 1;
        console.info(
          '[chat.indexing] page wikiId=%s pageId=%s title=%s',
          wikiId,
          row.id,
          row.title,
        );
      } else {
        pagesSkipped += 1;
      }
    } catch (err) {
      errors.push({
        kind: 'page',
        id: row.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // --- 2. Index every source cited by any page in the wiki ---------------
  const sourceRows = await db
    .prepare(
      `SELECT DISTINCT cit.source_id AS source_id, cit.content_hash AS content_hash
         FROM citations cit
         JOIN claims cl ON cl.id = cit.claim_id
         JOIN wiki_pages p ON p.id = cl.wiki_page_id
        WHERE p.wiki_id = ?`,
    )
    .bind(wikiId)
    .all<SourceRow>();

  let sourcesIndexed = 0;
  let sourcesSkipped = 0;
  for (const row of sourceRows.results) {
    try {
      const obj = await storage.get(`sources/${row.source_id}/text`);
      const text = obj ? await obj.text() : null;
      if (!text) {
        sourcesSkipped += 1;
        continue;
      }
      const out = await vectorReader.indexSource({
        wikiId,
        sourceId: row.source_id as SourceId,
        contentHash: row.content_hash as ContentHash,
        text,
      });
      if (out.chunks > 0) {
        sourcesIndexed += 1;
        console.info(
          '[chat.indexing] source wikiId=%s sourceId=%s chunks=%d',
          wikiId,
          row.source_id,
          out.chunks,
        );
      } else {
        sourcesSkipped += 1;
      }
    } catch (err) {
      errors.push({
        kind: 'source',
        id: row.source_id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { wikiId, sourcesIndexed, sourcesSkipped, pagesIndexed, pagesSkipped, errors };
};
