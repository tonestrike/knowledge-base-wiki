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

const rowToRun = (r: Row): CompileRun => ({
  id: parseRunId(r.id),
  folderId: parseFolderId(r.folder_id),
  wikiId: r.wiki_id ? parseWikiId(r.wiki_id) : undefined,
  status: r.status,
  startedAt: r.started_at,
  endedAt: r.ended_at ?? undefined,
  schemaInferredAt: r.schema_inferred_at ?? undefined,
  failureMessage: r.failure_message ?? undefined,
});

export const createD1CompileRunRepository = (db: D1Database): CompileRunRepository => ({
  async insert(r) {
    await db
      .prepare('INSERT INTO compile_runs (id, folder_id, status, started_at) VALUES (?, ?, ?, ?)')
      .bind(r.id, r.folderId, r.status, r.startedAt)
      .run();
  },
  async update(r) {
    await db
      .prepare(
        'UPDATE compile_runs SET wiki_id = ?, status = ?, ended_at = ?, schema_inferred_at = ?, failure_message = ? WHERE id = ?',
      )
      .bind(
        r.wikiId ?? null,
        r.status,
        r.endedAt ?? null,
        r.schemaInferredAt ?? null,
        r.failureMessage ?? null,
        r.id,
      )
      .run();
  },
  async findById(id) {
    const r = await db.prepare('SELECT * FROM compile_runs WHERE id = ?').bind(id).first<Row>();
    return r ? rowToRun(r) : null;
  },
});
