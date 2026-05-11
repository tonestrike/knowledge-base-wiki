import {
  type FolderId,
  type WikiId,
  type WikiPageId,
  WikiSchema,
  folderId as parseFolderId,
  wikiId as parseWikiId,
  wikiPageId as parseWikiPageId,
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
    try {
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
    } catch (err) {
      throw new Error(
        `[d1.wikis.insert id=${w.id}] ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
  async update(w) {
    try {
      await db
        .prepare(
          'UPDATE wikis SET schema_json = ?, updated_at = ?, last_compiled_at = ?, page_count = ? WHERE id = ?',
        )
        .bind(JSON.stringify(w.schema), w.updatedAt, w.lastCompiledAt ?? null, w.pageCount, w.id)
        .run();
    } catch (err) {
      throw new Error(
        `[d1.wikis.update id=${w.id}] ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
  async findById(id: WikiId) {
    try {
      const r = await db.prepare('SELECT * FROM wikis WHERE id = ?').bind(id).first<Row>();
      return r ? rowToWiki(r) : null;
    } catch (err) {
      throw new Error(
        `[d1.wikis.findById id=${id}] ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
  async findByFolderId(id: FolderId) {
    try {
      const r = await db.prepare('SELECT * FROM wikis WHERE folder_id = ?').bind(id).first<Row>();
      return r ? rowToWiki(r) : null;
    } catch (err) {
      throw new Error(
        `[d1.wikis.findByFolderId folderId=${id}] ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
  async list({ cursor, limit }) {
    try {
      const stmt = cursor
        ? db
            .prepare('SELECT * FROM wikis WHERE updated_at < ? ORDER BY updated_at DESC LIMIT ?')
            .bind(cursor, limit)
        : db.prepare('SELECT * FROM wikis ORDER BY updated_at DESC LIMIT ?').bind(limit);
      const { results } = await stmt.all<Row>();
      const items = results.map(rowToWiki);
      const nextCursor = items.length === limit ? items[items.length - 1]?.updatedAt : undefined;
      return { items, nextCursor };
    } catch (err) {
      throw new Error(
        `[d1.wikis.list cursor=${cursor ?? 'null'} limit=${limit}] ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
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
  async cascadeDelete(wikiId: WikiId): Promise<{ deletedPageIds: WikiPageId[] }> {
    try {
      // Snapshot the page ids first so the caller can clean up R2.
      const pageRows = await db
        .prepare('SELECT id FROM wiki_pages WHERE wiki_id = ?')
        .bind(wikiId)
        .all<{ id: string }>();
      const deletedPageIds = pageRows.results.map((r) => parseWikiPageId(r.id));
      // Cascade delete in dependency order. We don't have FK ON DELETE
      // CASCADE in the schema, so each leaf table is cleared explicitly
      // before its parent. Run as a D1 batch so we get one round trip
      // and atomic semantics — if any statement fails the whole tree
      // rolls back and the next call can retry cleanly.
      await db.batch([
        db
          .prepare(
            'DELETE FROM citations WHERE claim_id IN (SELECT id FROM claims WHERE wiki_page_id IN (SELECT id FROM wiki_pages WHERE wiki_id = ?))',
          )
          .bind(wikiId),
        db
          .prepare(
            'DELETE FROM claims WHERE wiki_page_id IN (SELECT id FROM wiki_pages WHERE wiki_id = ?)',
          )
          .bind(wikiId),
        db
          .prepare(
            'DELETE FROM backlinks WHERE from_page_id IN (SELECT id FROM wiki_pages WHERE wiki_id = ?)',
          )
          .bind(wikiId),
        db.prepare('DELETE FROM wiki_pages WHERE wiki_id = ?').bind(wikiId),
        db.prepare('DELETE FROM wikis WHERE id = ?').bind(wikiId),
      ]);
      return { deletedPageIds };
    } catch (err) {
      throw new Error(
        `[d1.wikis.cascadeDelete id=${wikiId}] ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
});
