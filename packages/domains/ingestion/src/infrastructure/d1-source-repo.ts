import type { Source as SourceWire } from '@package/contracts/ingestion';
import type { ContentHash, FolderId, SourceId } from '@package/contracts/shared';
import {
  contentHash as parseContentHash,
  folderId as parseFolderId,
  sourceId as parseSourceId,
} from '@package/contracts/shared';
import type { SourceRepository } from '../application/ports.ts';
import type { Manifest } from '../domain/source.ts';
import { Source } from '../domain/source.ts';
import type { D1DatabaseLike } from './cloudflare-bindings.ts';

interface Row {
  readonly id: string;
  readonly folder_id: string;
  readonly drive_file_id: string;
  readonly filename: string;
  readonly mime: Manifest['mime'];
  readonly size_bytes: number;
  readonly modified_at: string;
  readonly page_count: number | null;
  readonly content_hash: string;
  readonly fetched_at: string;
}

const rowToSource = (r: Row): Source =>
  Source.create({
    id: parseSourceId(r.id),
    folderId: parseFolderId(r.folder_id),
    manifest: {
      driveFileId: r.drive_file_id,
      filename: r.filename,
      mime: r.mime,
      sizeBytes: r.size_bytes,
      modifiedAt: r.modified_at,
      pageCount: r.page_count ?? undefined,
    },
    contentHash: parseContentHash(r.content_hash) as ContentHash,
    fetchedAt: r.fetched_at,
  });

const sourceToWire = (s: Source): SourceWire => ({
  id: s.id,
  folderId: s.folderId,
  driveFileId: s.manifest.driveFileId,
  filename: s.manifest.filename,
  mime: s.manifest.mime,
  contentHash: s.contentHash,
  pageCount: s.manifest.pageCount,
  fetchedAt: s.fetchedAt,
});

export const createD1SourceRepository = (db: D1DatabaseLike): SourceRepository => ({
  async insert(s) {
    await db
      .prepare(
        'INSERT INTO sources (id, folder_id, drive_file_id, filename, mime, size_bytes, modified_at, page_count, content_hash, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        s.id,
        s.folderId,
        s.manifest.driveFileId,
        s.manifest.filename,
        s.manifest.mime,
        s.manifest.sizeBytes,
        s.manifest.modifiedAt,
        s.manifest.pageCount ?? null,
        s.contentHash,
        s.fetchedAt,
      )
      .run();
  },

  async findById(id: SourceId) {
    const row = await db.prepare('SELECT * FROM sources WHERE id = ?').bind(id).first<Row>();
    return row ? rowToSource(row) : null;
  },

  async findByDriveFileId({ folderId, driveFileId }: { folderId: FolderId; driveFileId: string }) {
    const row = await db
      .prepare(
        'SELECT * FROM sources WHERE folder_id = ? AND drive_file_id = ? ORDER BY fetched_at DESC LIMIT 1',
      )
      .bind(folderId, driveFileId)
      .first<Row>();
    return row ? rowToSource(row) : null;
  },

  async list({ folderId, cursor, limit }: { folderId: FolderId; cursor?: string; limit: number }) {
    const stmt = cursor
      ? db
          .prepare(
            'SELECT * FROM sources WHERE folder_id = ? AND fetched_at < ? ORDER BY fetched_at DESC LIMIT ?',
          )
          .bind(folderId, cursor, limit)
      : db
          .prepare('SELECT * FROM sources WHERE folder_id = ? ORDER BY fetched_at DESC LIMIT ?')
          .bind(folderId, limit);
    const rows = await stmt.all<Row>();
    const items = rows.results.map(rowToSource);
    const last = rows.results[rows.results.length - 1];
    return {
      items,
      nextCursor: items.length === limit && last ? last.fetched_at : undefined,
    };
  },

  toWire: sourceToWire,
});
