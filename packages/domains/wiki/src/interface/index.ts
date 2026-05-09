import { ORPCError, implement } from '@orpc/server';
import { wikiContract } from '@package/contracts/wiki';
import type { Clock } from '@package/shared-kernel';

export interface WikiContext {
  clock: Clock;
}

const os = implement(wikiContract).$context<WikiContext>();

const todo = (procedure: string): never => {
  throw new ORPCError('NOT_IMPLEMENTED', {
    message: `wiki.${procedure} is scaffolded but not implemented (Slice 2.B)`,
  });
};

export const wikiRouter = {
  getWiki: os.getWiki.handler(() => todo('getWiki')),
  getSchema: os.getSchema.handler(() => todo('getSchema')),
  listWikis: os.listWikis.handler(() => todo('listWikis')),
  getPage: os.getPage.handler(() => todo('getPage')),
  listPages: os.listPages.handler(() => todo('listPages')),
  startCompile: os.startCompile.handler(() => todo('startCompile')),
  getCompileRun: os.getCompileRun.handler(() => todo('getCompileRun')),
  // biome-ignore lint/correctness/useYield: stub generator throws before yielding (Slice 2.B wires the real stream)
  streamCompileEvents: os.streamCompileEvents.handler(async function* () {
    todo('streamCompileEvents');
  }),
};
