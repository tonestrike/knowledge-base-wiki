import { ORPCError, implement } from '@orpc/server';
import { ingestionContract, mockIngestEventStream } from '@package/contracts/ingestion';
import type { UserId } from '@package/contracts/shared';
import type { Clock } from '@package/shared-kernel';
import { completeDriveAuth } from '../application/complete-drive-auth.ts';
import type { ExtractorRegistry } from '../application/extract-source.ts';
import { getFolder } from '../application/get-folder.ts';
import { getSource } from '../application/get-source.ts';
import { ingestFolder } from '../application/ingest-folder.ts';
import { listDriveFolders } from '../application/list-drive-folders.ts';
import { listSources } from '../application/list-sources.ts';
import type { IngestionDeps } from '../application/ports.ts';
import { registerFolder } from '../application/register-folder.ts';
import { startDriveAuth } from '../application/start-drive-auth.ts';

export interface IngestionContext extends IngestionDeps {
  readonly clock: Clock;
  readonly extractors: ExtractorRegistry;
  // Single-user demo: the wired Worker injects a constant UserId; multi-user
  // would derive this from a session cookie / auth header.
  readonly currentUserId?: UserId;
}

const os = implement(ingestionContract).$context<IngestionContext>();

export const ingestionRouter = {
  authStart: os.authStart.handler(async ({ context }) => {
    try {
      return await startDriveAuth(context);
    } catch (err) {
      // Surface the actionable cause (e.g. "GOOGLE_OAUTH_CLIENT_ID is unset")
      // instead of letting oRPC wrap the throw into a generic 500. The
      // connector throws a typed Error with a sentence the user can act on.
      const message = err instanceof Error ? err.message : 'Drive OAuth start failed.';
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message });
    }
  }),

  authCallback: os.authCallback.handler(({ context, input }) => completeDriveAuth(context, input)),

  listFolders: os.listFolders.handler(({ context, input }) => listDriveFolders(context, input)),

  registerFolder: os.registerFolder.handler(({ context, input }) => {
    if (!context.currentUserId) {
      throw new ORPCError('UNAUTHORIZED', {
        message: 'Sign in with Drive first.',
      });
    }
    return registerFolder({ ...context, currentUserId: context.currentUserId }, input);
  }),

  ingestFolder: os.ingestFolder.handler(async ({ context, input }) => {
    const folder = await context.folders.findById(input.folderId);
    if (!folder) {
      throw new ORPCError('NOT_FOUND', { message: 'Folder not registered.' });
    }
    // C1: enumerate documents inside the folder via `listFiles` (NOT
    // `listFolders`, which only returns sub-folders). Sub-folder recursion is
    // out of scope for v1.
    const list = await context.drive.listFiles({
      parentId: folder.driveFolderId,
      limit: 200,
    });
    const ids = list.files.map((f) => f.driveFileId);
    const out = await ingestFolder(
      { ...context, extractors: context.extractors },
      { folderId: input.folderId, driveFileIds: ids },
    );
    return { folderId: input.folderId, sourceCount: out.successful };
  }),

  // Phase 2.A streams the deterministic mock tape so 2.E can consume against a
  // real handler. Phase 3.1 replaces this with a per-IngestRunDO event tape
  // backed by KV/D1.
  streamIngestEvents: os.streamIngestEvents.handler(async function* () {
    yield* mockIngestEventStream();
  }),

  getFolder: os.getFolder.handler(({ context, input }) => getFolder(context, input)),

  getSource: os.getSource.handler(({ context, input }) => getSource(context, input)),

  listSources: os.listSources.handler(({ context, input }) => listSources(context, input)),
};
