import {
  type FolderId,
  type WikiId,
  WikiSchema,
  folderId as parseFolderId,
  wikiId as parseWikiId,
} from '@package/contracts/shared';
import type { Wiki as WikiWire } from '@package/contracts/wiki';
import type { WikiRepository } from '../application/ports.ts';
import { Wiki } from '../domain/wiki.ts';
import type { D1Database } from './cf-types.ts';

interface Row {
  id: string;
  folder_id: string;
  schema_json: string;
  created_at: string;
  updated_at: string;
  last_compiled_at: string | null;
  page_count: number;
}

const rowToWiki = (r: Row): Wiki =>
  Wiki.create({
    id: parseWikiId(r.id),
    folderId: parseFolderId(r.folder_id),
    schema: WikiSchema.parse(JSON.parse(r.schema_json)),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastCompiledAt: r.last_compiled_at ?? undefined,
    pageCount: r.page_count,
  });

export const createD1WikiRepository = (db: D1Database): WikiRepository => ({
  async insert(w) {
    await db
      .prepare(
        'INSERT INTO wikis (id, folder_id, schema_json, created_at, updated_at, last_compiled_at, page_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        w.id,
        w.folderId,
        JSON.stringify(w.schema),
        w.createdAt,
        w.updatedAt,
        w.lastCompiledAt ?? null,
        w.pageCount,
      )
      .run();
  },
  async update(w) {
    await db
      .prepare(
        'UPDATE wikis SET schema_json = ?, updated_at = ?, last_compiled_at = ?, page_count = ? WHERE id = ?',
      )
      .bind(JSON.stringify(w.schema), w.updatedAt, w.lastCompiledAt ?? null, w.pageCount, w.id)
      .run();
  },
  async findById(id: WikiId) {
    const r = await db.prepare('SELECT * FROM wikis WHERE id = ?').bind(id).first<Row>();
    return r ? rowToWiki(r) : null;
  },
  async findByFolderId(id: FolderId) {
    const r = await db.prepare('SELECT * FROM wikis WHERE folder_id = ?').bind(id).first<Row>();
    return r ? rowToWiki(r) : null;
  },
  async list({ cursor, limit }) {
    const stmt = cursor
      ? db
          .prepare('SELECT * FROM wikis WHERE updated_at < ? ORDER BY updated_at DESC LIMIT ?')
          .bind(cursor, limit)
      : db.prepare('SELECT * FROM wikis ORDER BY updated_at DESC LIMIT ?').bind(limit);
    const { results } = await stmt.all<Row>();
    const items = results.map(rowToWiki);
    const nextCursor = items.length === limit ? items[items.length - 1]?.updatedAt : undefined;
    return { items, nextCursor };
  },
  toWire(w): WikiWire {
    return {
      id: w.id,
      folderId: w.folderId,
      schema: w.schema,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
      lastCompiledAt: w.lastCompiledAt,
      pageCount: w.pageCount,
    };
  },
});
