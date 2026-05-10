import { type FolderId, type SourceId, sourceId as parseSourceId } from '@package/contracts/shared';
import type { ExtractedSourceText, SourceReader } from '../application/ports.ts';
import type { D1Database, R2Bucket } from './cf-types.ts';

interface SourceRow {
  id: string;
  filename: string;
  content_hash: string;
}

// Reads ingestion's published rows from D1 and the extracted text from R2.
// Wiki never writes to either side — that's the ingestion context's job.
// The two contexts agree on the table/key shape via the documented schema in
// spec §3.2; if ingestion ever changes its key layout, this adapter is the
// only place we need to update on the wiki side.
export const createSourceReader = (db: D1Database, bucket: R2Bucket): SourceReader => ({
  async list(folderId: FolderId) {
    try {
      const { results } = await db
        .prepare(
          'SELECT id, filename, content_hash FROM sources WHERE folder_id = ? ORDER BY fetched_at ASC',
        )
        .bind(folderId)
        .all<SourceRow>();
      return results.map((r) => ({
        sourceId: parseSourceId(r.id),
        filename: r.filename,
      }));
    } catch (err) {
      throw new Error(
        `[d1.sources.list folderId=${folderId}] ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
  async read(sourceId: SourceId): Promise<ExtractedSourceText | null> {
    try {
      const row = await db
        .prepare('SELECT id, filename, content_hash FROM sources WHERE id = ?')
        .bind(sourceId)
        .first<SourceRow>();
      if (!row) return null;
      const obj = await bucket.get(`sources/${sourceId}/text`);
      if (!obj) return null;
      const text = await obj.text();
      return {
        sourceId,
        filename: row.filename,
        contentHash: row.content_hash,
        text,
      };
    } catch (err) {
      throw new Error(
        `[sources.read sourceId=${sourceId}] ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
});
