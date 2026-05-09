import type { FolderId, UserId } from '@package/contracts/shared';
import { folderId as parseFolderId } from '@package/contracts/shared';
import type { IngestionDeps } from './ports.ts';

export interface RegisterFolderDeps extends IngestionDeps {
  readonly currentUserId: UserId;
}

export interface RegisterFolderInput {
  readonly driveFolderId: string;
  readonly name: string;
}

export interface RegisterFolderOutput {
  readonly folderId: FolderId;
}

export async function registerFolder(
  deps: RegisterFolderDeps,
  input: RegisterFolderInput,
): Promise<RegisterFolderOutput> {
  const id = parseFolderId(deps.newId());
  await deps.folders.upsert({
    folderId: id,
    userId: deps.currentUserId,
    driveFolderId: input.driveFolderId,
    name: input.name,
  });
  return { folderId: id };
}
