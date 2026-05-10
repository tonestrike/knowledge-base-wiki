import { ORPCError, implement } from '@orpc/server';
import { ingestionContract, mockIngestEventStream } from '@package/contracts/ingestion';
import type { UserId } from '@package/contracts/shared';
import type { Clock } from '@package/shared-kernel';
import { completeDriveAuth } from '../application/complete-drive-auth.ts';
import type { ExtractorRegistry } from '../application/extract-source.ts';
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
  authStart: os.authStart.handler(({ context }) => startDriveAuth(context)),

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
    // Phase 2.A treats a folder's children as the seed list. Sub-folders are
    // ignored in v1; recursive walk lands later.
    const list = await context.drive.listFolders({
      parentId: folder.driveFolderId,
      limit: 200,
    });
    const ids = list.folders.map((f) => f.driveFolderId);
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

  getSource: os.getSource.handler(({ context, input }) => getSource(context, input)),

  listSources: os.listSources.handler(({ context, input }) => listSources(context, input)),
};
