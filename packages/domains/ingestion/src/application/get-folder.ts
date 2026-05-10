import type { Folder } from '@package/contracts/ingestion';
import type { FolderId } from '@package/contracts/shared';
import type { IngestionDeps } from './ports.ts';

export class FolderNotFoundError extends Error {
  constructor(id: FolderId) {
    super(`Folder not found: ${id}`);
    this.name = 'FolderNotFoundError';
  }
}

export async function getFolder(deps: IngestionDeps, input: { id: FolderId }): Promise<Folder> {
  const f = await deps.folders.findById(input.id);
  if (!f) throw new FolderNotFoundError(input.id);
  return { id: f.id, name: f.name, driveFolderId: f.driveFolderId };
}
