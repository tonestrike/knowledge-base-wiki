import { describe, expect, it } from 'bun:test';
import { contentHash, sourceId, wikiId, wikiPageId } from '@package/contracts/shared';
import type { SourceSearchHit, WikiPageSummary, WikiReader } from '../application/ports.ts';
import type {
  D1Database,
  D1PreparedStatement,
  R2Bucket,
  VectorizeIndex,
  VectorizeQueryResult,
  VectorizeVector,
} from './cf-types.ts';
import type { Embedder } from './openrouter-embedder.ts';
import { EmbedderNotConfiguredError } from './openrouter-embedder.ts';
import { createVectorWikiReader } from './vector-wiki-reader.ts';

const wid = wikiId('44444444-2222-4333-8444-555555555555');
const sid = sourceId('11111111-2222-4333-8444-000000000001');
const hash = contentHash('sha256:abc');
const citingPid = wikiPageId('dddddddd-1111-4222-8333-444444444444');
const pid = wikiPageId('eeeeeeee-1111-4222-8333-444444444444');

const fakeInnerHit: SourceSearchHit = {
  sourceId: sid,
  excerpt: 'token-overlap fallback excerpt',
  byteRange: { start: 0, end: 30 },
  contentHash: hash,
  citingPages: [{ pageId: citingPid, title: 'Citing Page' }],
};

const fakePage: WikiPageSummary = {
  id: pid,
  wikiId: wid,
  title: 'Alignment Faking',
  pageType: 'Paper',
  body: 'A paper about deceptive alignment in trained models.',
  citations: [],
};

const innerStub = (overrides?: {
  searchSources?: WikiReader['searchSources'];
  searchPages?: WikiReader['searchPages'];
  getPage?: WikiReader['getPage'];
}): {
  reader: WikiReader;
  calls: { searchSources: number; searchPages: number; getPage: number };
} => {
  const calls = { searchSources: 0, searchPages: 0, getPage: 0 };
  const reader: WikiReader = {
    async searchPages(args) {
      calls.searchPages += 1;
      if (overrides?.searchPages) return overrides.searchPages(args);
      return [];
    },
    async listSamplePages() {
      return [];
    },
    async getPage(id) {
      calls.getPage += 1;
      if (overrides?.getPage) return overrides.getPage(id);
      return null;
    },
    async listPagesByType() {
      return [];
    },
    async getWikiMeta() {
      return null;
    },
    async searchSources(args) {
      calls.searchSources += 1;
      if (overrides?.searchSources) return overrides.searchSources(args);
      return [fakeInnerHit];
    },
  };
  return { reader, calls };
};

const fakeDb = (rows: {
  allowed: Array<{ source_id: string; content_hash: string }>;
  citing: Array<{ source_id: string; page_id: string; title: string; page_type: string | null }>;
}): D1Database => {
  const prepare = (query: string): D1PreparedStatement => {
    const stmt: D1PreparedStatement = {
      bind(): D1PreparedStatement {
        return stmt;
      },
      async first() {
        return null;
      },
      async all<T = unknown>(): Promise<{ results: T[] }> {
        if (query.includes('page_id')) {
          return { results: rows.citing as unknown as T[] };
        }
        return { results: rows.allowed as unknown as T[] };
      },
      async run() {
        return { success: true };
      },
    };
    return stmt;
  };
  return {
    prepare,
    async batch() {
      return [];
    },
  };
};

const fakeStorage = (texts: Record<string, string>): R2Bucket => ({
  async put() {
    return {};
  },
  async get(key) {
    const text = texts[key];
    if (!text) return null;
    return {
      async text() {
        return text;
      },
      async arrayBuffer() {
        return new TextEncoder().encode(text).buffer as ArrayBuffer;
      },
    };
  },
  async delete() {
    /* no-op */
  },
});

const fakeVectorize = (
  result: VectorizeQueryResult,
  upserts: VectorizeVector[][] = [],
): VectorizeIndex => ({
  async query() {
    return result;
  },
  async upsert(vs) {
    upserts.push(vs);
    return { count: vs.length };
  },
});

const fixedEmbedder = (vec: readonly number[]): Embedder => ({
  async embed(texts) {
    return texts.map(() => [...vec]);
  },
});

const throwingEmbedder = (): Embedder => ({
  async embed() {
    throw new EmbedderNotConfiguredError();
  },
});

describe('createVectorWikiReader · searchSources', () => {
  it('falls back to the inner reader when the embedder throws', async () => {
    const { reader, calls } = innerStub();
    const v = createVectorWikiReader({
      db: fakeDb({ allowed: [], citing: [] }),
      storage: fakeStorage({}),
      vectorize: fakeVectorize({ matches: [] }),
      embedder: throwingEmbedder(),
      inner: reader,
    });
    const hits = await v.searchSources({ wikiId: wid, query: 'alignment faking', limit: 5 });
    expect(calls.searchSources).toBe(1);
    expect(hits).toEqual([fakeInnerHit]);
  });

  it('falls back when Vectorize returns zero matches', async () => {
    const { reader, calls } = innerStub();
    const v = createVectorWikiReader({
      db: fakeDb({ allowed: [], citing: [] }),
      storage: fakeStorage({}),
      vectorize: fakeVectorize({ matches: [] }),
      embedder: fixedEmbedder([0.1, 0.2]),
      inner: reader,
    });
    const hits = await v.searchSources({ wikiId: wid, query: 'mesa optimizer', limit: 5 });
    expect(calls.searchSources).toBe(1);
    expect(hits).toEqual([fakeInnerHit]);
  });

  it('returns semantic hits when Vectorize matches and D1/R2 resolve', async () => {
    const { reader, calls } = innerStub();
    const fullText = `${'a'.repeat(200)} deceptive AI behavior emerges in trained policies. ${'b'.repeat(200)}`;
    const v = createVectorWikiReader({
      db: fakeDb({
        allowed: [{ source_id: sid, content_hash: hash }],
        citing: [
          { source_id: sid, page_id: citingPid, title: 'Alignment Faking', page_type: 'Paper' },
        ],
      }),
      storage: fakeStorage({ [`sources/${sid}/text`]: fullText }),
      vectorize: fakeVectorize({
        matches: [
          {
            id: `source:${sid}:0`,
            score: 0.91,
            metadata: {
              kind: 'source',
              sourceId: sid,
              wikiId: wid,
              chunkStart: 0,
              chunkEnd: 300,
              hash,
            },
          },
        ],
      }),
      embedder: fixedEmbedder([0.1, 0.2]),
      inner: reader,
    });
    const hits = await v.searchSources({ wikiId: wid, query: 'deceptive AI', limit: 5 });
    expect(calls.searchSources).toBe(0);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.sourceId).toBe(sid);
    expect(hits[0]?.byteRange).toEqual({ start: 0, end: 300 });
    expect(hits[0]?.excerpt).toContain('deceptive AI');
    expect(hits[0]?.citingPages[0]?.title).toBe('Alignment Faking');
  });

  it('skips page-kind matches in the source-search path', async () => {
    const { reader, calls } = innerStub();
    const fullText = 'source body for the test';
    const v = createVectorWikiReader({
      db: fakeDb({
        allowed: [{ source_id: sid, content_hash: hash }],
        citing: [{ source_id: sid, page_id: citingPid, title: 'Citing', page_type: 'Paper' }],
      }),
      storage: fakeStorage({ [`sources/${sid}/text`]: fullText }),
      vectorize: fakeVectorize({
        matches: [
          {
            id: `page:${pid}`,
            score: 0.95,
            metadata: { kind: 'page', wikiPageId: pid, wikiId: wid, slug: 'alignment-faking' },
          },
        ],
      }),
      embedder: fixedEmbedder([0.1, 0.2]),
      inner: reader,
    });
    const hits = await v.searchSources({ wikiId: wid, query: 'whatever', limit: 5 });
    // Only page-kind matches → no source hits → fall through to inner.
    expect(calls.searchSources).toBe(1);
    expect(hits).toEqual([fakeInnerHit]);
  });

  it('falls back when matches exist but none belong to the wiki', async () => {
    const { reader, calls } = innerStub();
    const v = createVectorWikiReader({
      db: fakeDb({ allowed: [], citing: [] }),
      storage: fakeStorage({}),
      vectorize: fakeVectorize({
        matches: [
          {
            id: `source:${sid}:0`,
            score: 0.91,
            metadata: {
              kind: 'source',
              sourceId: sid,
              wikiId: 'other-wiki',
              chunkStart: 0,
              chunkEnd: 300,
              hash,
            },
          },
        ],
      }),
      embedder: fixedEmbedder([0.1, 0.2]),
      inner: reader,
    });
    const hits = await v.searchSources({ wikiId: wid, query: 'test', limit: 5 });
    expect(calls.searchSources).toBe(1);
    expect(hits).toEqual([fakeInnerHit]);
  });
});

describe('createVectorWikiReader · searchPages (semantic searchWiki)', () => {
  it('falls back to inner.searchPages when the embedder throws', async () => {
    const { reader, calls } = innerStub();
    const v = createVectorWikiReader({
      db: fakeDb({ allowed: [], citing: [] }),
      storage: fakeStorage({}),
      vectorize: fakeVectorize({ matches: [] }),
      embedder: throwingEmbedder(),
      inner: reader,
    });
    const out = await v.searchPages({ wikiId: wid, query: 'anything', limit: 5 });
    expect(calls.searchPages).toBe(1);
    expect(out).toEqual([]);
  });

  it('returns hydrated wiki pages when Vectorize matches `kind:page` records', async () => {
    const { reader, calls } = innerStub({
      getPage: async (id) => (id === pid ? fakePage : null),
    });
    const v = createVectorWikiReader({
      db: fakeDb({ allowed: [], citing: [] }),
      storage: fakeStorage({}),
      vectorize: fakeVectorize({
        matches: [
          {
            id: `page:${pid}`,
            score: 0.92,
            metadata: {
              kind: 'page',
              wikiPageId: pid,
              wikiId: wid,
              pageType: 'Paper',
              slug: 'alignment-faking',
            },
          },
        ],
      }),
      embedder: fixedEmbedder([0.1, 0.2]),
      inner: reader,
    });
    const out = await v.searchPages({ wikiId: wid, query: 'deceptive AI', limit: 5 });
    expect(calls.searchPages).toBe(0);
    expect(calls.getPage).toBe(1);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe(pid);
    expect(out[0]?.title).toBe('Alignment Faking');
  });

  it('ignores page matches from other wikis and falls through when nothing remains', async () => {
    const { reader, calls } = innerStub();
    const v = createVectorWikiReader({
      db: fakeDb({ allowed: [], citing: [] }),
      storage: fakeStorage({}),
      vectorize: fakeVectorize({
        matches: [
          {
            id: `page:${pid}`,
            score: 0.92,
            metadata: {
              kind: 'page',
              wikiPageId: pid,
              wikiId: 'some-other-wiki',
              slug: 'other-page',
            },
          },
        ],
      }),
      embedder: fixedEmbedder([0.1, 0.2]),
      inner: reader,
    });
    const out = await v.searchPages({ wikiId: wid, query: 'q', limit: 5 });
    expect(calls.searchPages).toBe(1);
    expect(out).toEqual([]);
  });
});

describe('createVectorWikiReader · indexSource', () => {
  it('chunks text and upserts vectors with kind:source metadata + namespaced ids', async () => {
    const { reader } = innerStub();
    const upserts: VectorizeVector[][] = [];
    const v = createVectorWikiReader({
      db: fakeDb({ allowed: [], citing: [] }),
      storage: fakeStorage({}),
      vectorize: fakeVectorize({ matches: [] }, upserts),
      embedder: fixedEmbedder([0.1, 0.2, 0.3]),
      inner: reader,
    });
    const text = 'x'.repeat(2500);
    const out = await v.indexSource({ wikiId: wid, sourceId: sid, contentHash: hash, text });
    expect(out.chunks).toBe(3);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toHaveLength(3);
    const first = upserts[0]?.[0];
    expect(first?.id).toBe(`source:${sid}:0`);
    expect(first?.metadata).toMatchObject({
      kind: 'source',
      sourceId: sid,
      wikiId: wid,
      chunkStart: 0,
      hash,
    });
    expect(first?.values).toEqual([0.1, 0.2, 0.3]);
  });

  it('returns 0 chunks for empty text', async () => {
    const { reader } = innerStub();
    const upserts: VectorizeVector[][] = [];
    const v = createVectorWikiReader({
      db: fakeDb({ allowed: [], citing: [] }),
      storage: fakeStorage({}),
      vectorize: fakeVectorize({ matches: [] }, upserts),
      embedder: fixedEmbedder([0.1]),
      inner: reader,
    });
    const out = await v.indexSource({ wikiId: wid, sourceId: sid, contentHash: hash, text: '' });
    expect(out.chunks).toBe(0);
    expect(upserts).toHaveLength(0);
  });
});

describe('createVectorWikiReader · indexWikiPage', () => {
  it('embeds title + body as one vector and upserts under `page:<id>`', async () => {
    const { reader } = innerStub();
    const upserts: VectorizeVector[][] = [];
    const v = createVectorWikiReader({
      db: fakeDb({ allowed: [], citing: [] }),
      storage: fakeStorage({}),
      vectorize: fakeVectorize({ matches: [] }, upserts),
      embedder: fixedEmbedder([0.5, 0.4, 0.3]),
      inner: reader,
    });
    const out = await v.indexWikiPage({
      id: pid,
      wikiId: wid,
      title: 'Alignment Faking',
      body: 'A paper about deceptive alignment.',
      pageType: 'Paper',
      slug: 'alignment-faking',
    });
    expect(out.indexed).toBe(true);
    expect(upserts).toHaveLength(1);
    const first = upserts[0]?.[0];
    expect(first?.id).toBe(`page:${pid}`);
    expect(first?.metadata).toMatchObject({
      kind: 'page',
      wikiPageId: pid,
      wikiId: wid,
      pageType: 'Paper',
      slug: 'alignment-faking',
    });
    expect(first?.values).toEqual([0.5, 0.4, 0.3]);
  });

  it('skips empty pages without calling the embedder', async () => {
    const { reader } = innerStub();
    const upserts: VectorizeVector[][] = [];
    let embedCalls = 0;
    const v = createVectorWikiReader({
      db: fakeDb({ allowed: [], citing: [] }),
      storage: fakeStorage({}),
      vectorize: fakeVectorize({ matches: [] }, upserts),
      embedder: {
        async embed() {
          embedCalls += 1;
          return [[]];
        },
      },
      inner: reader,
    });
    const out = await v.indexWikiPage({
      id: pid,
      wikiId: wid,
      title: '',
      body: '',
      slug: 'empty',
    });
    expect(out.indexed).toBe(false);
    expect(upserts).toHaveLength(0);
    expect(embedCalls).toBe(0);
  });
});
