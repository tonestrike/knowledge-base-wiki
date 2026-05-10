import {
  folderId as parseFolderId,
  compileRunId as parseRunId,
  wikiId as parseWikiId,
} from '@package/contracts/shared';
import type { CompileRunRepository } from '../application/ports.ts';
import type { CompileRun, CompileRunStatus } from '../domain/compile-run.ts';
import type { D1Database } from './cf-types.ts';

interface Row {
  id: string;
  folder_id: string;
  wiki_id: string | null;
  status: CompileRunStatus;
  started_at: string;
  ended_at: string | null;
  schema_inferred_at: string | null;
  failure_message: string | null;
}

// Reconstruct a status-discriminated CompileRun from its row. Each variant
// carries exactly the fields the domain says it must.
const rowToRun = (r: Row): CompileRun => {
  const id = parseRunId(r.id);
  const folderId = parseFolderId(r.folder_id);
  const startedAt = r.started_at;
  switch (r.status) {
    case 'pending':
      return Object.freeze({ id, folderId, startedAt, status: 'pending' as const });
    case 'inferring-schema':
      return Object.freeze({ id, folderId, startedAt, status: 'inferring-schema' as const });
    case 'planning':
    case 'researching':
    case 'drafting':
    case 'linking':
    case 'indexing': {
      if (!r.schema_inferred_at) {
        throw new Error(`compile_runs row ${r.id} status=${r.status} missing schema_inferred_at`);
      }
      return Object.freeze({
        id,
        folderId,
        startedAt,
        status: r.status,
        schemaInferredAt: r.schema_inferred_at,
      });
    }
    case 'finished': {
      if (!r.wiki_id || !r.ended_at || !r.schema_inferred_at) {
        throw new Error(
          `compile_runs row ${r.id} status=finished missing wiki_id/ended_at/schema_inferred_at`,
        );
      }
      return Object.freeze({
        id,
        folderId,
        startedAt,
        status: 'finished' as const,
        schemaInferredAt: r.schema_inferred_at,
        wikiId: parseWikiId(r.wiki_id),
        endedAt: r.ended_at,
      });
    }
    case 'failed': {
      if (!r.ended_at || !r.failure_message) {
        throw new Error(`compile_runs row ${r.id} status=failed missing ended_at/failure_message`);
      }
      return Object.freeze({
        id,
        folderId,
        startedAt,
        status: 'failed' as const,
        schemaInferredAt: r.schema_inferred_at ?? undefined,
        failureMessage: r.failure_message,
        endedAt: r.ended_at,
      });
    }
  }
};

// Pull the optional terminal/transition fields out of a discriminated run
// for the UPDATE statement; null where the variant doesn't carry them.
const updateColumns = (r: CompileRun) => {
  const wikiId = r.status === 'finished' ? r.wikiId : null;
  const endedAt = r.status === 'finished' || r.status === 'failed' ? r.endedAt : null;
  const schemaInferredAt =
    r.status === 'planning' ||
    r.status === 'researching' ||
    r.status === 'drafting' ||
    r.status === 'linking' ||
    r.status === 'indexing' ||
    r.status === 'finished'
      ? r.schemaInferredAt
      : r.status === 'failed'
        ? (r.schemaInferredAt ?? null)
        : null;
  const failureMessage = r.status === 'failed' ? r.failureMessage : null;
  return { wikiId, endedAt, schemaInferredAt, failureMessage };
};

export const createD1CompileRunRepository = (db: D1Database): CompileRunRepository => ({
  async insert(r) {
    try {
      await db
        .prepare('INSERT INTO compile_runs (id, folder_id, status, started_at) VALUES (?, ?, ?, ?)')
        .bind(r.id, r.folderId, r.status, r.startedAt)
        .run();
    } catch (err) {
      throw new Error(
        `[d1.compile_runs.insert id=${r.id}] ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
  async update(r) {
    const { wikiId, endedAt, schemaInferredAt, failureMessage } = updateColumns(r);
    try {
      await db
        .prepare(
          'UPDATE compile_runs SET wiki_id = ?, status = ?, ended_at = ?, schema_inferred_at = ?, failure_message = ? WHERE id = ?',
        )
        .bind(wikiId, r.status, endedAt, schemaInferredAt, failureMessage, r.id)
        .run();
    } catch (err) {
      throw new Error(
        `[d1.compile_runs.update id=${r.id} status=${r.status}] ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
  async findById(id) {
    try {
      const r = await db.prepare('SELECT * FROM compile_runs WHERE id = ?').bind(id).first<Row>();
      return r ? rowToRun(r) : null;
    } catch (err) {
      throw new Error(
        `[d1.compile_runs.findById id=${id}] ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
});
