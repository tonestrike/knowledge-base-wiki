import type { FolderId, UserId } from '@package/contracts/shared';
import { folderId as parseFolderId, userId as parseUserId } from '@package/contracts/shared';
import type { FolderRepository } from '../application/ports.ts';
import type { D1DatabaseLike } from './cloudflare-bindings.ts';

interface FolderRow {
  readonly id: string;
  readonly user_id: string;
  readonly drive_folder_id: string;
  readonly name: string;
}

export const createD1FolderRepository = (db: D1DatabaseLike): FolderRepository => ({
  async upsert({ folderId, userId, driveFolderId, name }) {
    await db
      .prepare(
        'INSERT INTO folders (id, user_id, drive_folder_id, name) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, drive_folder_id) DO UPDATE SET name = excluded.name',
      )
      .bind(folderId, userId, driveFolderId, name)
      .run();
  },
  async findById(id: FolderId) {
    const r = await db
      .prepare('SELECT id, user_id, drive_folder_id, name FROM folders WHERE id = ?')
      .bind(id)
      .first<FolderRow>();
    if (!r) return null;
    return {
      id: parseFolderId(r.id) as FolderId,
      userId: parseUserId(r.user_id) as UserId,
      driveFolderId: r.drive_folder_id,
      name: r.name,
    };
  },
});
