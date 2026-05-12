import { describe, expect, it } from 'bun:test';
import { wikiPageId } from '@package/contracts/shared';
import { InMemoryEventBus } from '@package/shared-kernel';
import type { WikiReader } from '../application/ports.ts';
import type {
  D1Database,
  D1PreparedStatement,
  R2Bucket,
  VectorizeIndex,
  VectorizeVector,
} from './cf-types.ts';
import { subscribeIndexing } from './index-on-events.ts';
import type { Embedder } from './openrouter-embedder.ts';
import { createVectorWikiReader } from './vector-wiki-reader.ts';

const WIKI_ID = '11111111-2222-4333-8444-555555555555';
const PAGE_ID = 'aaaaaaaa-2222-4333-8444-555555555555';
const SOURCE_ID = 'bbbbbbbb-2222-4333-8444-555555555555';
const CONTENT_HASH = 'sha256:test';
const PAGE_BODY = 'Alignment faking — a paper about deceptive alignment in trained models.';
const SOURCE_TEXT = 'This is the underlying source text for the demo. '.repeat(40);

const buildDb = (): D1Database => {
  const prepare = (query: string): D1PreparedStatement => {
    const stmt: D1PreparedStatement = {
      bind(): D1PreparedStatement {
        return stmt;
      },
      async first() {
        return null;
      },
      async all<T = unknown>(): Promise<{ results: T[] }> {
        if (query.includes('FROM wiki_pages')) {
          return {
            results: [
              {
                id: PAGE_ID,
                wiki_id: WIKI_ID,
                title: 'Alignment Faking',
                page_type: 'Paper',
                slug: 'alignment-faking',
              },
            ] as unknown as T[],
          };
        }
        if (query.includes('FROM citations')) {
          return {
            results: [{ source_id: SOURCE_ID, content_hash: CONTENT_HASH }] as unknown as T[],
          };
        }
        return { results: [] };
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

const buildStorage = (): R2Bucket => ({
  async put() {
    return {};
  },
  async get(key) {
    if (key === `wiki_pages/${PAGE_ID}.md`) {
      return {
        async text() {
          return PAGE_BODY;
        },
        async arrayBuffer() {
          return new TextEncoder().encode(PAGE_BODY).buffer as ArrayBuffer;
        },
      };
    }
    if (key === `sources/${SOURCE_ID}/text`) {
      return {
        async text() {
          return SOURCE_TEXT;
        },
        async arrayBuffer() {
          return new TextEncoder().encode(SOURCE_TEXT).buffer as ArrayBuffer;
        },
      };
    }
    return null;
  },
  async delete() {
    /* no-op */
  },
});

const buildVectorize = (
  upserts: VectorizeVector[][],
  queries: Array<readonly number[]>,
  matchesFor: () => VectorizeVector[],
): VectorizeIndex => ({
  async query(vector) {
    queries.push(vector);
    return {
      matches: matchesFor().map((v) => ({
        id: v.id,
        score: 0.9,
        metadata: v.metadata,
      })),
    };
  },
  async upsert(vs) {
    upserts.push(vs);
    return { count: vs.length };
  },
});

const counterEmbedder = (): Embedder => ({
  async embed(texts) {
    return texts.map((_, i) => [0.1 + i * 0.01, 0.2, 0.3]);
  },
});

const stubInner: WikiReader = {
  async searchPages() {
    return [];
  },
  async listSamplePages() {
    return [];
  },
  async getPage(id) {
    if (id === PAGE_ID) {
      return {
        id,
        wikiId: WIKI_ID as never,
        title: 'Alignment Faking',
        pageType: 'Paper',
        body: PAGE_BODY,
        citations: [],
      };
    }
    return null;
  },
  async listPagesByType() {
    return [];
  },
  async getWikiMeta() {
    return null;
  },
  async searchSources() {
    return [];
  },
};

describe('subscribeIndexing', () => {
  it('on CompileFinished, embeds every page + source and upserts into Vectorize', async () => {
    const bus = new InMemoryEventBus();
    const upserts: VectorizeVector[][] = [];
    const queries: Array<readonly number[]> = [];
    const vectorize = buildVectorize(upserts, queries, () => []);
    const vectorReader = createVectorWikiReader({
      db: buildDb(),
      storage: buildStorage(),
      vectorize,
      embedder: counterEmbedder(),
      inner: stubInner,
    });

    subscribeIndexing(bus, {
      vectorReader,
      db: buildDb(),
      storage: buildStorage(),
    });

    await bus.publish({
      name: 'CompileFinished',
      occurredAt: new Date().toISOString(),
      payload: {
        compileRunId: 'run-1',
        wikiId: WIKI_ID,
        finishedAt: new Date().toISOString(),
        pageCount: 1,
      },
    });

    // One upsert for the page, plus N upserts for the source chunks.
    expect(upserts.length).toBeGreaterThanOrEqual(2);
    const pageUpsert = upserts.find((u) => u[0]?.id?.startsWith('page:'));
    const sourceUpsert = upserts.find((u) => u[0]?.id?.startsWith('source:'));
    expect(pageUpsert).toBeDefined();
    expect(sourceUpsert).toBeDefined();
    expect(pageUpsert?.[0]?.id).toBe(`page:${PAGE_ID}`);
    expect(pageUpsert?.[0]?.metadata).toMatchObject({
      kind: 'page',
      wikiPageId: PAGE_ID,
      wikiId: WIKI_ID,
      pageType: 'Paper',
    });
    expect(sourceUpsert?.[0]?.id).toMatch(/^source:/);
    expect(sourceUpsert?.[0]?.metadata).toMatchObject({
      kind: 'source',
      sourceId: SOURCE_ID,
      wikiId: WIKI_ID,
    });
  });

  it('searchPages over the same reader returns the indexed page when Vectorize matches it back', async () => {
    const upserts: VectorizeVector[][] = [];
    const queries: Array<readonly number[]> = [];
    // Build a vectorize that returns the page-kind record stored from
    // the bus-event upsert, so the subsequent searchPages call hits a
    // real semantic match (and never falls through to inner).
    const vectorize = buildVectorize(upserts, queries, () =>
      upserts
        .flat()
        .filter((v) => v.id.startsWith('page:'))
        .slice(0, 5),
    );
    const vectorReader = createVectorWikiReader({
      db: buildDb(),
      storage: buildStorage(),
      vectorize,
      embedder: counterEmbedder(),
      inner: stubInner,
    });

    const bus = new InMemoryEventBus();
    subscribeIndexing(bus, {
      vectorReader,
      db: buildDb(),
      storage: buildStorage(),
    });
    await bus.publish({
      name: 'CompileFinished',
      occurredAt: new Date().toISOString(),
      payload: {
        compileRunId: 'run-1',
        wikiId: WIKI_ID,
        finishedAt: new Date().toISOString(),
        pageCount: 1,
      },
    });

    const hits = await vectorReader.searchPages({
      wikiId: WIKI_ID as never,
      query: 'deceptive alignment',
      limit: 5,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe(wikiPageId(PAGE_ID));
    expect(hits[0]?.title).toBe('Alignment Faking');
    // We embedded the query at least once for the searchPages call (plus
    // the per-page + per-source embeddings during indexing).
    expect(queries.length).toBeGreaterThanOrEqual(1);
  });
});
