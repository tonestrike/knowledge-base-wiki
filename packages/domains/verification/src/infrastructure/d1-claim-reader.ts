import type { Citation, Claim, ClaimId, WikiId, WikiPageId } from '@package/contracts/shared';
import type { ClaimReader } from '../application/ports.ts';
import type { D1Database } from './d1-lint-run-repo.ts';

/**
 * Direct D1 ClaimReader — reads claims + their citations from D1 without
 * going through oRPC. Used for the lint pass which needs to enumerate every
 * Claim across every WikiPage of a Wiki.
 *
 * The cross-context oRPC alternative lives in `orpc-claim-reader.ts`; the
 * composition root in `apps/api/src/build-verification-deps.ts` picks the
 * direct adapter today because the lint pass runs in the same Worker that
 * owns the D1 binding — re-entering via oRPC would burn subrequest budget
 * for no isolation benefit.
 */
export const createDirectD1ClaimReader = (db: D1Database): ClaimReader => ({
  async listWikiIds() {
    const rows = await db.prepare('SELECT id FROM wikis').all<{ id: string }>();
    return rows.results.map((r) => r.id as WikiId);
  },
  async listClaimsForWiki(wikiId: WikiId) {
    const out: Array<{ wikiPageId: WikiPageId; claim: Claim }> = [];
    const pageRows = await db
      .prepare('SELECT id FROM wiki_pages WHERE wiki_id = ?')
      .bind(wikiId)
      .all<{ id: string }>();
    for (const p of pageRows.results) {
      const claimRows = await db
        .prepare('SELECT id, paragraph_id, claim_text FROM claims WHERE wiki_page_id = ?')
        .bind(p.id)
        .all<{ id: string; paragraph_id: string; claim_text: string }>();
      for (const c of claimRows.results) {
        const citeRows = await db
          .prepare(
            'SELECT id, source_id, byte_range_start, byte_range_end, content_hash, label FROM citations WHERE claim_id = ?',
          )
          .bind(c.id)
          .all<{
            id: string;
            source_id: string;
            byte_range_start: number;
            byte_range_end: number;
            content_hash: string;
            label: string;
          }>();
        const citations: Citation[] = citeRows.results.map((r) => ({
          id: r.id as ClaimId & { __brand: 'CitationId' } as never,
          label: r.label,
          span: {
            sourceId: r.source_id as never,
            byteRange: { start: r.byte_range_start, end: r.byte_range_end },
            contentHash: r.content_hash as never,
          },
        }));
        out.push({
          wikiPageId: p.id as WikiPageId,
          claim: {
            id: c.id as ClaimId,
            wikiPageId: p.id as WikiPageId,
            paragraphId: c.paragraph_id,
            claimText: c.claim_text,
            citations,
          } as Claim,
        });
      }
    }
    return out;
  },
});
