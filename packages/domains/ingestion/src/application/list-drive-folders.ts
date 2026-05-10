import type { DriveFolder } from '@package/contracts/ingestion';
import type { IngestionDeps } from './ports.ts';

export interface ListDriveFoldersInput {
  readonly parentId?: string;
  readonly query?: string;
  readonly limit: number;
}

export async function listDriveFolders(
  deps: IngestionDeps,
  input: ListDriveFoldersInput,
): Promise<{ folders: DriveFolder[]; nextPageToken?: string }> {
  return deps.drive.listFolders(input);
}
