import { ORPCError, implement } from '@orpc/server';
import { ingestionContract } from '@package/contracts/ingestion';
import type { Clock } from '@package/shared-kernel';

export interface IngestionContext {
  clock: Clock;
}

const os = implement(ingestionContract).$context<IngestionContext>();

const todo = (procedure: string): never => {
  throw new ORPCError('NOT_IMPLEMENTED', {
    message: `ingestion.${procedure} is scaffolded but not implemented (Slice 2.A)`,
  });
};

export const ingestionRouter = {
  authStart: os.authStart.handler(() => todo('authStart')),
  authCallback: os.authCallback.handler(() => todo('authCallback')),
  listFolders: os.listFolders.handler(() => todo('listFolders')),
  registerFolder: os.registerFolder.handler(() => todo('registerFolder')),
  ingestFolder: os.ingestFolder.handler(() => todo('ingestFolder')),
  // biome-ignore lint/correctness/useYield: stub generator throws before yielding (Slice 2.A wires the real stream)
  streamIngestEvents: os.streamIngestEvents.handler(async function* () {
    todo('streamIngestEvents');
  }),
  getSource: os.getSource.handler(() => todo('getSource')),
  listSources: os.listSources.handler(() => todo('listSources')),
};
