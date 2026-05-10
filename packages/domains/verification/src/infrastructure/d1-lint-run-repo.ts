import { type LintRunId, type WikiId, lintRunId, wikiId } from '@package/contracts/shared';
import type { LintRun as LintRunWire } from '@package/contracts/verification';
import type { LintRunRepository } from '../application/ports.ts';
import type { LintRun, LintRunStatus } from '../domain/lint-run.ts';

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

const fromRow = (row: LintRunRow): LintRun => ({
  id: lintRunId(row.id),
  wikiId: wikiId(row.wiki_id),
  status: row.status as LintRunStatus,
  totalClaims: row.total_claims,
  audited: row.audited,
  unsupportedCount: row.unsupported_count,
  contradictedCount: row.contradicted_count,
  startedAt: row.started_at,
  endedAt: row.ended_at ?? undefined,
  failureMessage: row.failure_message ?? undefined,
});

const toWire = (r: LintRun): LintRunWire => ({
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
