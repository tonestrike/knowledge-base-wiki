import { ORPCError, implement } from '@orpc/server';
import { compileRunId as parseCompileRunId } from '@package/contracts/shared';
import { wikiContract } from '@package/contracts/wiki';
import type { Clock } from '@package/shared-kernel';
import { deleteWiki } from '../application/delete-wiki.ts';
import { getCompileRun } from '../application/get-compile-run.ts';
import { getGaps } from '../application/get-gaps.ts';
import { getPage } from '../application/get-page.ts';
import { getSchema } from '../application/get-schema.ts';
import { getWiki } from '../application/get-wiki.ts';
import { listPages } from '../application/list-pages.ts';
import { listWikis } from '../application/list-wikis.ts';
import type { WikiDeps } from '../application/ports.ts';

export interface WikiContext extends WikiDeps {
  clock: Clock;
}

const wrapNotFound = (e: unknown): never => {
  if (e instanceof Error && /not found/i.test(e.message)) {
    throw new ORPCError('NOT_FOUND', { message: e.message });
  }
  throw e;
};

const os = implement(wikiContract).$context<WikiContext>();

export const wikiRouter = {
  getWiki: os.getWiki.handler(async ({ context, input }) => {
    try {
      return await getWiki(context, input);
    } catch (e) {
      return wrapNotFound(e);
    }
  }),
  getSchema: os.getSchema.handler(async ({ context, input }) => {
    try {
      return await getSchema(context, input);
    } catch (e) {
      return wrapNotFound(e);
    }
  }),
  listWikis: os.listWikis.handler(({ context, input }) => listWikis(context, input)),
  gaps: os.gaps.handler(async ({ context, input }) => {
    try {
      return await getGaps(context, input);
    } catch (e) {
      return wrapNotFound(e);
    }
  }),
  getPage: os.getPage.handler(async ({ context, input }) => {
    try {
      return await getPage(context, input);
    } catch (e) {
      return wrapNotFound(e);
    }
  }),
  listPages: os.listPages.handler(({ context, input }) => listPages(context, input)),
  startCompile: os.startCompile.handler(async ({ context, input }) => {
    const id = parseCompileRunId(context.newId());
    await context.dispatcher.start({
      compileRunId: id,
      folderId: input.folderId,
      ...(input.perspective !== undefined ? { perspective: input.perspective } : {}),
    });
    return { compileRunId: id };
  }),
  getCompileRun: os.getCompileRun.handler(async ({ context, input }) => {
    try {
      return await getCompileRun(context, input);
    } catch (e) {
      return wrapNotFound(e);
    }
  }),
  streamCompileEvents: os.streamCompileEvents.handler(async function* ({ context, input }) {
    for await (const e of context.dispatcher.subscribe(input.compileRunId)) {
      yield e;
    }
  }),
  deleteWiki: os.deleteWiki.handler(({ context, input }) => deleteWiki(context, input)),
};

export { subscribeWikiEvents } from './cross-context-subscriptions.ts';
