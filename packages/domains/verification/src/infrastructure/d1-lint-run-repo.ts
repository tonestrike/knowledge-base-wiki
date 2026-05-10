import { type LintRunId, type WikiId, lintRunId, wikiId } from '@package/contracts/shared';
import type { LintRun as LintRunWire } from '@package/contracts/verification';
import { z } from 'zod';
import type { LintRunRepository } from '../application/ports.ts';
import { LintRun, type LintRun as LintRunDomain, type LintRunStatus } from '../domain/lint-run.ts';

// Minimal D1 binding shape — apps/api injects `env.DB`. Defined locally to
// keep the framework dependency out of the repo file's interface contract.
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean }>;
}

interface LintRunRow {
  id: string;
  wiki_id: string;
  status: string;
  total_claims: number;
  audited: number;
  unsupported_count: number;
  contradicted_count: number;
  started_at: string;
  ended_at: string | null;
  failure_message: string | null;
}

const LintRunStatusSchema: z.ZodType<LintRunStatus> = z.enum([
  'pending',
  'running',
  'finished',
  'failed',
]);

// Reconstructs a LintRun from a stored row. Each status maps to a different
// variant of the LintRun discriminated union, so per-status invariants
// (`endedAt` mandatory on finished/failed, `failureMessage` mandatory on
// failed) are enforced by construction. Throws on a row whose persisted
// state is inconsistent — that indicates a writer bug, never silently
// repairable here.
const fromRow = (row: LintRunRow): LintRunDomain => {
  // PR #6 type-design finding — Zod-parse the status string instead of
  // casting; an unknown status from a future schema migration must light up
  // here, not silently propagate as `LintRunStatus`.
  const status = LintRunStatusSchema.parse(row.status);
  const id = lintRunId(row.id);
  const wid = wikiId(row.wiki_id);
  const startedAt = row.started_at;

  switch (status) {
    case 'pending':
    case 'running': {
      const base = LintRun.start({
        id,
        wikiId: wid,
        totalClaims: row.total_claims,
        startedAt,
      });
      const tallied = LintRun.tally(base, {
        auditedDelta: row.audited,
        unsupportedDelta: row.unsupported_count,
        contradictedDelta: row.contradicted_count,
      });
      return status === 'running' ? LintRun.run(tallied) : tallied;
    }
    case 'finished': {
      if (!row.ended_at) {
        throw new Error(`lint_runs row ${row.id}: status=finished requires ended_at`);
      }
      const tallied = LintRun.tally(
        LintRun.run(
          LintRun.start({
            id,
            wikiId: wid,
            totalClaims: row.total_claims,
            startedAt,
          }),
        ),
        {
          auditedDelta: row.audited,
          unsupportedDelta: row.unsupported_count,
          contradictedDelta: row.contradicted_count,
        },
      );
      return LintRun.finish(tallied, row.ended_at);
    }
    case 'failed': {
      if (!row.ended_at || !row.failure_message) {
        throw new Error(
          `lint_runs row ${row.id}: status=failed requires ended_at and failure_message`,
        );
      }
      const tallied = LintRun.tally(
        LintRun.run(
          LintRun.start({
            id,
            wikiId: wid,
            totalClaims: row.total_claims,
            startedAt,
          }),
        ),
        {
          auditedDelta: row.audited,
          unsupportedDelta: row.unsupported_count,
          contradictedDelta: row.contradicted_count,
        },
      );
      return LintRun.fail(tallied, row.failure_message, row.ended_at);
    }
  }
};

const toWire = (r: LintRunDomain): LintRunWire => ({
  id: r.id,
  wikiId: r.wikiId,
  status: r.status,
  totalClaims: r.totalClaims,
  audited: r.audited,
  unsupportedCount: r.unsupportedCount,
  contradictedCount: r.contradictedCount,
  startedAt: r.startedAt,
  endedAt: r.endedAt,
});

export const createD1LintRunRepository = (db: D1Database): LintRunRepository => ({
  async insert(r) {
    await db
      .prepare(
        `INSERT INTO lint_runs (id, wiki_id, status, total_claims, audited, unsupported_count, contradicted_count, started_at, ended_at, failure_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        r.id,
        r.wikiId,
        r.status,
        r.totalClaims,
        r.audited,
        r.unsupportedCount,
        r.contradictedCount,
        r.startedAt,
        r.endedAt ?? null,
        r.failureMessage ?? null,
      )
      .run();
  },

  async update(r) {
    await db
      .prepare(
        `UPDATE lint_runs
         SET status = ?, total_claims = ?, audited = ?, unsupported_count = ?, contradicted_count = ?, started_at = ?, ended_at = ?, failure_message = ?
         WHERE id = ?`,
      )
      .bind(
        r.status,
        r.totalClaims,
        r.audited,
        r.unsupportedCount,
        r.contradictedCount,
        r.startedAt,
        r.endedAt ?? null,
        r.failureMessage ?? null,
        r.id,
      )
      .run();
  },

  async findById(id: LintRunId) {
    const row = await db
      .prepare('SELECT * FROM lint_runs WHERE id = ?')
      .bind(id)
      .first<LintRunRow>();
    return row ? fromRow(row) : null;
  },

  async list({ wikiId: filterWikiId, cursor, limit }) {
    const offset = cursor ? Number.parseInt(cursor, 10) : 0;
    const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;
    const sql = filterWikiId
      ? 'SELECT * FROM lint_runs WHERE wiki_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?'
      : 'SELECT * FROM lint_runs ORDER BY started_at DESC LIMIT ? OFFSET ?';
    const stmt = filterWikiId
      ? db.prepare(sql).bind(filterWikiId, limit + 1, safeOffset)
      : db.prepare(sql).bind(limit + 1, safeOffset);
    const { results } = await stmt.all<LintRunRow>();
    const items = results.slice(0, limit).map(fromRow);
    const nextCursor = results.length > limit ? String(safeOffset + limit) : undefined;
    return { items, nextCursor };
  },

  toWire(r) {
    return toWire(r);
  },
});

// Coerce-from-row for use by sibling repos.
export const lintRunFromRow = fromRow;
export const lintRunToWire = toWire;
export type { LintRunRow, WikiId };
