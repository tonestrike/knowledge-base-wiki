import {
  type LintFindingId,
  claimId,
  lintFindingId,
  lintRunId,
  wikiPageId,
} from '@package/contracts/shared';
import { Citation, Claim } from '@package/contracts/shared';
import type { LintFinding as LintFindingWire } from '@package/contracts/verification';
import type { LintFindingRepository } from '../application/ports.ts';
import { Correction } from '../domain/correction.ts';
import { LintFinding, type Verdict } from '../domain/lint-finding.ts';
import type { D1Database } from './d1-lint-run-repo.ts';

interface LintFindingRow {
  id: string;
  lint_run_id: string;
  wiki_page_id: string;
  claim_id: string;
  claim_json: string;
  verdict: 'supported' | 'unsupported' | 'contradicted';
  evidence_text: string;
  cited_spans_json: string;
  correction_json: string | null;
  resolved_at: string | null;
}

const fromRow = (row: LintFindingRow): LintFinding => {
  const claim = Claim.parse(JSON.parse(row.claim_json));
  const citedSpans = (JSON.parse(row.cited_spans_json) as unknown[]).map((c) => Citation.parse(c));
  const correctionRaw = row.correction_json ? JSON.parse(row.correction_json) : null;
  const correction = correctionRaw
    ? Correction.create({
        replacementText: correctionRaw.replacementText,
        newCitationLabel: correctionRaw.newCitationLabel,
      })
    : undefined;
  const base = {
    id: lintFindingId(row.id),
    lintRunId: lintRunId(row.lint_run_id),
    wikiPageId: wikiPageId(row.wiki_page_id),
    claimId: claimId(row.claim_id),
    claim,
    evidenceText: row.evidence_text,
    citedSpans,
  };
  // Dispatch on the persisted verdict so the discriminated-union variant is
  // constructed correctly (PR #6 type-design: LintFinding is a discriminated
  // union; `correction` is required on non-supported variants).
  let finding: LintFinding;
  switch (row.verdict) {
    case 'supported':
      finding = LintFinding.create({ ...base, verdict: 'supported' });
      break;
    case 'unsupported':
    case 'contradicted':
      if (!correction) {
        throw new Error(
          `lint_findings row ${row.id}: verdict=${row.verdict} requires a stored correction_json`,
        );
      }
      finding = LintFinding.create({ ...base, verdict: row.verdict, correction });
      break;
  }
  return row.resolved_at ? LintFinding.resolve(finding, row.resolved_at) : finding;
};

const toWire = (f: LintFinding): LintFindingWire => ({
  id: f.id,
  lintRunId: f.lintRunId,
  wikiPageId: f.wikiPageId,
  claimId: f.claimId,
  claim: f.claim,
  verdict: f.verdict,
  evidenceText: f.evidenceText,
  citedSpans: [...f.citedSpans],
  correction: f.correction,
  resolvedAt: f.resolvedAt,
});

export const createD1LintFindingRepository = (db: D1Database): LintFindingRepository => ({
  async insertMany(fs) {
    for (const f of fs) {
      await db
        .prepare(
          `INSERT INTO lint_findings (id, lint_run_id, wiki_page_id, claim_id, claim_json, verdict, evidence_text, cited_spans_json, correction_json, resolved_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          f.id,
          f.lintRunId,
          f.wikiPageId,
          f.claimId,
          JSON.stringify(f.claim),
          f.verdict,
          f.evidenceText,
          JSON.stringify(f.citedSpans),
          f.correction ? JSON.stringify(f.correction) : null,
          f.resolvedAt ?? null,
        )
        .run();
    }
  },

  async update(f) {
    await db
      .prepare(
        `UPDATE lint_findings
         SET verdict = ?, evidence_text = ?, cited_spans_json = ?, correction_json = ?, resolved_at = ?
         WHERE id = ?`,
      )
      .bind(
        f.verdict,
        f.evidenceText,
        JSON.stringify(f.citedSpans),
        f.correction ? JSON.stringify(f.correction) : null,
        f.resolvedAt ?? null,
        f.id,
      )
      .run();
  },

  async findById(id: LintFindingId) {
    const row = await db
      .prepare('SELECT * FROM lint_findings WHERE id = ?')
      .bind(id)
      .first<LintFindingRow>();
    return row ? fromRow(row) : null;
  },

  async list({ lintRunId: runId, verdict, cursor, limit }) {
    const offset = cursor ? Number.parseInt(cursor, 10) : 0;
    const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;
    const stmt: unknown = verdict
      ? db
          .prepare(
            'SELECT * FROM lint_findings WHERE lint_run_id = ? AND verdict = ? ORDER BY rowid ASC LIMIT ? OFFSET ?',
          )
          .bind(runId, verdict satisfies Verdict, limit + 1, safeOffset)
      : db
          .prepare(
            'SELECT * FROM lint_findings WHERE lint_run_id = ? ORDER BY rowid ASC LIMIT ? OFFSET ?',
          )
          .bind(runId, limit + 1, safeOffset);
    const { results } = await (stmt as ReturnType<D1Database['prepare']>).all<LintFindingRow>();
    const items = results.slice(0, limit).map(fromRow);
    const nextCursor = results.length > limit ? String(safeOffset + limit) : undefined;
    return { items, nextCursor };
  },

  toWire(f) {
    return toWire(f);
  },
});

export { fromRow as lintFindingFromRow, toWire as lintFindingToWire };
