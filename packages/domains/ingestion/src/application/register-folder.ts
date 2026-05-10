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
  // Mint a candidate id; the repo's upsert returns the PERSISTED id, which on
  // re-register is the existing row's id (I1). The candidate is dropped on
  // conflict — wasteful but the cost is one UUID and an INSERT-then-rollback
  // path inside SQLite, not a network round-trip.
  const candidate = parseFolderId(deps.newId());
  const { folderId } = await deps.folders.upsert({
    folderId: candidate,
    userId: deps.currentUserId,
    driveFolderId: input.driveFolderId,
    name: input.name,
  });
  return { folderId };
}
