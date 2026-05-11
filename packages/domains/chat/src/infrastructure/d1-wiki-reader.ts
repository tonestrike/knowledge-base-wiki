import type {
  Citation,
  CitationId,
  ContentHash,
  SourceId,
  WikiId,
  WikiPageId,
} from '@package/contracts/shared';
import type {
  SourceSearchHit,
  WikiMeta,
  WikiPageSummary,
  WikiReader,
} from '../application/ports.ts';
import type { D1Database, R2Bucket } from './cf-types.ts';

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
    // Bodies live at R2 key `wiki_pages/<id>.md`. The canonical writer
    // is `createR2WikiPageStorage(bucket).put(id, body)` (in
    // packages/domains/wiki/src/infrastructure/r2-wiki-page-storage.ts),
    // which prefixes with `wiki_pages/` and suffixes `.md`. An earlier
    // version of this reader hit the bare `row.id` and silently got
    // null bodies — the chat then surfaced only source-excerpt
    // fragments (via `expandWithSourceEvidence` below) and the synth
    // reported "findings are empty fragments". The `body_r2_key` column
    // in D1 stores the same key but we hardcode the prefix here to
    // match the writer's contract directly.
    const obj = await storage.get(`wiki_pages/${row.id}.md`);
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
