import { describe, expect, it } from 'bun:test';
import { compileRunId, folderId, sourceId, wikiId, wikiPageId } from '@package/contracts/shared';
import { demoSchema } from '@package/contracts/wiki';
import { getCompileRun } from './get-compile-run.ts';
import { getPage } from './get-page.ts';
import { getSchema } from './get-schema.ts';
import { getWiki } from './get-wiki.ts';
import { listPages } from './list-pages.ts';
import { listWikis } from './list-wikis.ts';
import type { WikiDeps } from './ports.ts';

const FID = folderId('22222222-2222-4333-8444-555555555555');
const WID = wikiId('44444444-2222-4333-8444-555555555555');
const PID = wikiPageId('dddddddd-1111-4222-8333-444444444444');
const RID = compileRunId('33333333-2222-4333-8444-555555555555');

const baseDeps = (): WikiDeps => {
  const wikiAgg = {
    id: WID,
    folderId: FID,
    schema: demoSchema,
    createdAt: '2026-05-09T12:00:00.000Z',
    updatedAt: '2026-05-09T12:00:00.000Z',
    pageCount: 0,
  };
  const pageAgg = {
    id: PID,
    wikiId: WID,
    subtype: 'Concept' as const,
    pageType: 'Decision',
    slug: 's',
    title: 't',
    body: 'b',
    claims: [],
    citations: [],
    backlinks: [],
    updatedAt: '2026-05-09T12:00:00.000Z',
  };
  return {
    llm: {} as never,
    sources: {
      list: async () => [
        { sourceId: sourceId('11111111-2222-4333-8444-000000000001'), filename: 'q3.pdf' },
      ],
      read: async () => null,
    },
    wikis: {
      insert: async () => undefined,
      update: async () => undefined,
      findById: async (id) => (id === WID ? (wikiAgg as never) : null),
      findByFolderId: async () => null,
      list: async () => ({ items: [wikiAgg as never] }),
      toWire: (w) => ({
        id: w.id,
        folderId: w.folderId,
        schema: w.schema,
        createdAt: '2026-05-09T12:00:00.000Z',
        updatedAt: '2026-05-09T12:00:00.000Z',
        pageCount: 0,
      }),
      cascadeDelete: async () => ({ deletedPageIds: [] }),
    },
    pages: {
      insertMany: async () => undefined,
      findById: async (id) => (id === PID ? (pageAgg as never) : null),
      list: async () => ({ items: [] }),
      toWire: (p) => ({
        id: p.id,
        wikiId: p.wikiId,
        subtype: p.subtype,
        pageType: p.subtype === 'Concept' || p.subtype === 'Index' ? p.pageType : undefined,
        slug: p.slug,
        title: p.title,
        body: p.body,
        claims: [],
        citations: [],
        backlinks: [],
        updatedAt: '2026-05-09T12:00:00.000Z',
      }),
    },
    runs: {
      insert: async () => undefined,
      update: async () => undefined,
      findById: async (id) =>
        id === RID
          ? ({
              id: RID,
              folderId: FID,
              status: 'finished' as const,
              startedAt: '2026-05-09T12:00:00.000Z',
              schemaInferredAt: '2026-05-09T12:00:01.000Z',
              wikiId: WID,
              endedAt: '2026-05-09T12:01:00.000Z',
            } as never)
          : null,
    },
    dispatcher: {} as never,
    gapAnalyzer: {
      analyze: async () => ({
        pageTypeWithNoPages: [],
        pagesWithNoClaims: [],
        claimsWithNoCitations: [],
        sourcesNeverCited: [],
      }),
    },
    eventBus: { publish: async () => undefined, subscribe: () => () => undefined },
    newId: () => '00000000-0000-4000-8000-000000000000',
    now: () => new Date('2026-05-09T12:00:00.000Z'),
  };
};

describe('reads', () => {
  it('getWiki', async () => {
    expect(await getWiki(baseDeps(), { id: WID })).toBeTruthy();
  });
  it('getSchema', async () => {
    expect((await getSchema(baseDeps(), { id: WID })).pageTypes.length).toBeGreaterThan(0);
  });
  it('getPage', async () => {
    expect(await getPage(baseDeps(), { id: PID })).toBeTruthy();
  });
  it('listWikis', async () => {
    expect((await listWikis(baseDeps(), { limit: 10 })).items).toHaveLength(1);
  });
  it('listPages', async () => {
    expect((await listPages(baseDeps(), { wikiId: WID, limit: 10 })).items).toEqual([]);
  });
  it('getCompileRun', async () => {
    const r = await getCompileRun(baseDeps(), { id: RID });
    expect(r.status).toBe('finished');
  });

  it('getWiki throws on missing', async () => {
    const d = baseDeps();
    d.wikis.findById = async () => null;
    await expect(getWiki(d, { id: WID })).rejects.toThrow(/not found/i);
  });
  it('getPage throws on missing', async () => {
    const d = baseDeps();
    d.pages.findById = async () => null;
    await expect(getPage(d, { id: PID })).rejects.toThrow(/not found/i);
  });
  it('getCompileRun throws on missing', async () => {
    const d = baseDeps();
    d.runs.findById = async () => null;
    await expect(getCompileRun(d, { id: RID })).rejects.toThrow(/not found/i);
  });
});
