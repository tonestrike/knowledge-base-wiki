import {
  type Citation,
  type Claim,
  type ContentHash,
  type WikiId,
  citationId as parseCitationId,
  claimId as parseClaimId,
  sourceId as parseSourceId,
  wikiId as parseWikiId,
  wikiPageId as parseWikiPageId,
} from '@package/contracts/shared';
import type { WikiPageSubtype, WikiPage as WikiPageWire } from '@package/contracts/wiki';
import type { WikiPageRepository } from '../application/ports.ts';
import { Backlink } from '../domain/backlink.ts';
import {
  type ConceptPage,
  type IndexEntry,
  type IndexPage,
  type SummaryPage,
  WikiPage,
} from '../domain/wiki-page.ts';
import type { D1Database, D1PreparedStatement } from './cf-types.ts';
import type { WikiPageBodyStorage } from './r2-wiki-page-storage.ts';

interface PageRow {
  id: string;
  wiki_id: string;
  subtype: WikiPageSubtype;
  page_type: string | null;
  slug: string;
  title: string;
  body_r2_key: string;
  source_id: string | null;
  question: string | null;
  index_entries_json: string | null;
  updated_at: string;
}

interface ClaimRow {
  id: string;
  wiki_page_id: string;
  paragraph_id: string;
  claim_text: string;
  position: number;
}

interface CitationRow {
  id: string;
  claim_id: string;
  source_id: string;
  byte_range_start: number;
  byte_range_end: number;
  content_hash: string;
  label: string;
}

interface BacklinkRow {
  from_page_id: string;
  to_page_id: string;
  relation_name: string;
}

const bodyKey = (id: string): string => `wiki_pages/${id}.md`;

export const createD1WikiPageRepository = (
  db: D1Database,
  storage: WikiPageBodyStorage,
): WikiPageRepository => ({
  async insertMany(pages) {
    if (pages.length === 0) return;

    // Bodies live in R2 — write them first so a partial D1 batch never points
    // at missing markdown.
    for (const p of pages) {
      await storage.put(p.id, p.body);
    }

    const stmts: D1PreparedStatement[] = [];
    for (const p of pages) {
      stmts.push(
        db
          .prepare(
            'INSERT INTO wiki_pages (id, wiki_id, subtype, page_type, slug, title, body_r2_key, source_id, question, index_entries_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            p.id,
            p.wikiId,
            p.subtype,
            p.subtype === 'Concept' || p.subtype === 'Index' ? p.pageType : null,
            p.slug,
            p.title,
            bodyKey(p.id),
            p.subtype === 'Summary' ? (p as SummaryPage).sourceId : null,
            p.subtype === 'Answer' ? (p as { question: string }).question : null,
            p.subtype === 'Index' ? JSON.stringify((p as IndexPage).entries) : null,
            p.updatedAt,
          ),
      );
      let claimPosition = 0;
      for (const claim of p.claims) {
        stmts.push(
          db
            .prepare(
              'INSERT INTO claims (id, wiki_page_id, paragraph_id, claim_text, position) VALUES (?, ?, ?, ?, ?)',
            )
            .bind(claim.id, p.id, claim.paragraphId, claim.claimText, claimPosition++),
        );
        for (const cite of claim.citations) {
          stmts.push(
            db
              .prepare(
                'INSERT INTO citations (id, claim_id, source_id, byte_range_start, byte_range_end, content_hash, label) VALUES (?, ?, ?, ?, ?, ?, ?)',
              )
              .bind(
                cite.id,
                claim.id,
                cite.span.sourceId,
                cite.span.byteRange.start,
                cite.span.byteRange.end,
                cite.span.contentHash,
                cite.label,
              ),
          );
        }
      }
      for (const bl of p.backlinks) {
        stmts.push(
          db
            .prepare(
              'INSERT OR IGNORE INTO backlinks (from_page_id, to_page_id, relation_name) VALUES (?, ?, ?)',
            )
            .bind(bl.fromPageId, bl.toPageId, bl.relationName ?? ''),
        );
      }
    }
    await db.batch(stmts);
  },

  async findById(id) {
    const r = await db.prepare('SELECT * FROM wiki_pages WHERE id = ?').bind(id).first<PageRow>();
    if (!r) return null;
    const body = (await storage.get(parseWikiPageId(r.id))) ?? '';
    const claimsRows = await db
      .prepare('SELECT * FROM claims WHERE wiki_page_id = ? ORDER BY position ASC')
      .bind(r.id)
      .all<ClaimRow>();
    const claims: Claim[] = [];
    for (const c of claimsRows.results) {
      const citationRows = await db
        .prepare('SELECT * FROM citations WHERE claim_id = ?')
        .bind(c.id)
        .all<CitationRow>();
      const citations: Citation[] = citationRows.results.map((row) => ({
        id: parseCitationId(row.id),
        label: row.label,
        span: {
          sourceId: parseSourceId(row.source_id),
          byteRange: { start: row.byte_range_start, end: row.byte_range_end },
          contentHash: row.content_hash as ContentHash,
        },
      }));
      claims.push({
        id: parseClaimId(c.id),
        wikiPageId: parseWikiPageId(c.wiki_page_id),
        paragraphId: c.paragraph_id,
        claimText: c.claim_text,
        citations,
      });
    }
    const backlinkRows = await db
      .prepare('SELECT * FROM backlinks WHERE from_page_id = ?')
      .bind(r.id)
      .all<BacklinkRow>();
    const backlinks = backlinkRows.results.map((row) =>
      Backlink.create({
        fromPageId: parseWikiPageId(row.from_page_id),
        toPageId: parseWikiPageId(row.to_page_id),
        relationName: row.relation_name || undefined,
      }),
    );

    return rowToPage(r, body, claims, backlinks);
  },

  async list({ wikiId, subtype, pageType, cursor, limit }) {
    const filters: string[] = ['wiki_id = ?'];
    const params: unknown[] = [wikiId];
    if (subtype) {
      filters.push('subtype = ?');
      params.push(subtype);
    }
    if (pageType) {
      filters.push('page_type = ?');
      params.push(pageType);
    }
    if (cursor) {
      filters.push('updated_at < ?');
      params.push(cursor);
    }
    params.push(limit);
    const sql = `SELECT * FROM wiki_pages WHERE ${filters.join(' AND ')} ORDER BY updated_at DESC LIMIT ?`;
    const { results } = await db
      .prepare(sql)
      .bind(...params)
      .all<PageRow>();
    const items = await Promise.all(
      results.map(async (r) => {
        const body = (await storage.get(parseWikiPageId(r.id))) ?? '';
        // List endpoints return shallow pages — claims/citations/backlinks
        // are fetched on the dedicated `getPage` route.
        return rowToPage(r, body, [], []);
      }),
    );
    const nextCursor = items.length === limit ? items[items.length - 1]?.updatedAt : undefined;
    return { items, nextCursor };
  },

  toWire(p): WikiPageWire {
    return {
      id: p.id,
      wikiId: p.wikiId,
      subtype: p.subtype,
      pageType: p.subtype === 'Concept' || p.subtype === 'Index' ? p.pageType : undefined,
      slug: p.slug,
      title: p.title,
      body: p.body,
      claims: [...p.claims],
      citations: [...p.citations],
      backlinks: [...p.backlinks],
      updatedAt: p.updatedAt,
    };
  },
});

const rowToPage = (
  r: PageRow,
  body: string,
  claims: Claim[],
  backlinks: Backlink[],
): ConceptPage | SummaryPage | IndexPage | (ConceptPage & { question?: string }) => {
  const id = parseWikiPageId(r.id);
  const wid = parseWikiId(r.wiki_id);
  switch (r.subtype) {
    case 'Concept':
      return WikiPage.concept({
        id,
        wikiId: wid,
        pageType: r.page_type ?? '',
        slug: r.slug,
        title: r.title,
        body,
        claims,
        backlinks,
        updatedAt: r.updated_at,
      });
    case 'Summary':
      if (!r.source_id) throw new Error(`SummaryPage row ${r.id} missing source_id`);
      return WikiPage.summary({
        id,
        wikiId: wid,
        sourceId: parseSourceId(r.source_id),
        slug: r.slug,
        title: r.title,
        body,
        claims,
        backlinks,
        updatedAt: r.updated_at,
      });
    case 'Answer':
      return WikiPage.answer({
        id,
        wikiId: wid,
        question: r.question ?? '',
        slug: r.slug,
        title: r.title,
        body,
        claims,
        backlinks,
        updatedAt: r.updated_at,
      }) as unknown as ConceptPage;
    case 'Index': {
      const entries = (
        r.index_entries_json ? JSON.parse(r.index_entries_json) : []
      ) as IndexEntry[];
      const reconstructed = WikiPage.index({
        id,
        wikiId: wid,
        pageType: r.page_type ?? '',
        slug: r.slug,
        title: r.title,
        entries: entries.length > 0 ? entries : [{ pageId: id, title: r.title }],
        backlinks,
        updatedAt: r.updated_at,
      });
      // Replace the auto-generated body with the stored R2 body so updates
      // survive even if the entries JSON drifts.
      return Object.freeze({ ...reconstructed, body }) as IndexPage;
    }
  }
};

export type { WikiId };
