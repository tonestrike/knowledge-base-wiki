import {
  createAnthropicVerifier,
  createD1LintFindingRepository,
  createD1LintRunRepository,
  createR2SourceTextReader,
} from '@domain/verification/infrastructure';
import type { VerificationContext } from '@domain/verification/interface';
import type { ClaimReader, LintRunDispatcher } from '@domain/verification/ports';
import type { Citation, Claim, ClaimId, WikiId, WikiPageId } from '@package/contracts/shared';
import type { EventBus } from '@package/shared-kernel';
import { newId } from '@package/shared-kernel';

export interface VerificationBindings {
  DB: D1Database;
  STORAGE: R2Bucket;
  OPEN_ROUTER_API_KEY?: string;
}

// In-memory lint dispatcher for local dev (no LINT_RUN DO yet). For the demo,
// every `start` call copies the pre-seeded `__seed/lint` template findings
// into a new lint_run row keyed by the requested lintRunId — so clicking
// "Run audit" always shows the planted contradiction without burning real
// Opus 4.7 calls. The DO-based dispatcher (createCfLintRunDispatcher) is
// the production path; this stub holds the line until that ships.
const SEED_TEMPLATE_LINT_RUN_ID = '33333333-3333-4333-8333-333333333333';
const createInMemoryLintDispatcher = (db: D1Database): LintRunDispatcher => {
  return {
    async start({ lintRunId, wikiId }) {
      console.info(`[verification] in-memory dispatch lintRunId=${lintRunId} wikiId=${wikiId}`);
      // Find the template run + its findings (pre-seeded via __seed/lint).
      const template = await db
        .prepare('SELECT * FROM lint_runs WHERE id = ?')
        .bind(SEED_TEMPLATE_LINT_RUN_ID)
        .first<{
          id: string;
          status: string;
          total_claims: number;
          audited: number;
          unsupported_count: number;
          contradicted_count: number;
        }>();
      if (!template) {
        // No template seeded yet — write a finished empty run so the UI
        // doesn't hang in 'pending'.
        const now = new Date().toISOString();
        await db
          .prepare(
            'INSERT OR REPLACE INTO lint_runs (id, wiki_id, status, total_claims, audited, unsupported_count, contradicted_count, started_at, ended_at) VALUES (?, ?, ?, 0, 0, 0, 0, ?, ?)',
          )
          .bind(lintRunId, wikiId, 'finished', now, now)
          .run();
        return;
      }
      const templateFindings = await db
        .prepare(
          'SELECT id, wiki_page_id, claim_id, claim_json, verdict, evidence_text, cited_spans_json, correction_json FROM lint_findings WHERE lint_run_id = ?',
        )
        .bind(SEED_TEMPLATE_LINT_RUN_ID)
        .all<{
          id: string;
          wiki_page_id: string;
          claim_id: string;
          claim_json: string;
          verdict: 'supported' | 'unsupported' | 'contradicted';
          evidence_text: string;
          cited_spans_json: string;
          correction_json: string | null;
        }>();
      const now = new Date().toISOString();
      await db
        .prepare(
          'INSERT OR REPLACE INTO lint_runs (id, wiki_id, status, total_claims, audited, unsupported_count, contradicted_count, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          lintRunId,
          wikiId,
          'finished',
          template.total_claims,
          template.audited,
          template.unsupported_count,
          template.contradicted_count,
          now,
          now,
        )
        .run();
      for (const f of templateFindings.results) {
        await db
          .prepare(
            'INSERT INTO lint_findings (id, lint_run_id, wiki_page_id, claim_id, claim_json, verdict, evidence_text, cited_spans_json, correction_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            crypto.randomUUID(),
            lintRunId,
            f.wiki_page_id,
            f.claim_id,
            f.claim_json,
            f.verdict,
            f.evidence_text,
            f.cited_spans_json,
            f.correction_json,
          )
          .run();
      }
    },
    subscribe: async function* () {
      // Empty event stream — real DO yields LintEvent's; the in-memory
      // stub yields nothing so the SSE consumer terminates cleanly.
    },
  };
};

// Builds the api-side verification context. The dispatcher routes lint runs
// to the LintRunDO (which holds the verifier + repos itself); the api-side
// context provides only the read-side handlers (listFindings, getLintRun,
// applyCorrection, plus start/streamLintEvents which delegate to the DO).
//
// claims: an in-process ClaimReader that reads from D1's claims+citations
// tables directly (the orpc-claim-reader is also available but we already
// have the bindings here, so a direct reader is faster for local dev).
export const buildVerificationContext = (
  env: VerificationBindings,
  eventBus: EventBus,
  clock: { now(): Date },
): VerificationContext => {
  const verifier = createAnthropicVerifier({
    apiKey: env.OPEN_ROUTER_API_KEY ?? '',
  });
  const claims = createDirectD1ClaimReader(env.DB);
  const sourceText = createR2SourceTextReader(env.STORAGE);
  const runs = createD1LintRunRepository(env.DB);
  const findings = createD1LintFindingRepository(env.DB);
  const lintDispatcher = createInMemoryLintDispatcher(env.DB);

  return {
    clock,
    verifier,
    claims,
    sourceText,
    runs,
    findings,
    lintDispatcher,
    eventBus,
    newId,
    now: () => clock.now(),
  } as VerificationContext;
};

// Direct D1 ClaimReader — reads claims + their citations from D1 without
// going through oRPC. Used for the lint pass which needs to enumerate every
// Claim across every WikiPage of a Wiki.
const createDirectD1ClaimReader = (db: D1Database): ClaimReader => ({
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
