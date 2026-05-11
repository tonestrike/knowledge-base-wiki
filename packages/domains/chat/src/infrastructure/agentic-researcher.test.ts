import { describe, expect, it } from 'bun:test';
import { citationId, contentHash, sourceId, wikiId, wikiPageId } from '@package/contracts/shared';
import type { Citation } from '@package/contracts/shared';
import { type LanguageModel, simulateReadableStream } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import type { WikiPageSummary, WikiReader } from '../application/ports.ts';
import { createAgenticResearcher } from './agentic-researcher.ts';

const wid = wikiId('44444444-2222-4333-8444-555555555555');
const pid = wikiPageId('dddddddd-1111-4222-8333-444444444444');
const cit: Citation = {
  id: citationId('aaaaaaaa-1111-4222-8333-444444444444'),
  label: 'metrics deck',
  span: {
    sourceId: sourceId('11111111-2222-4333-8444-000000000001'),
    byteRange: { start: 0, end: 50 },
    contentHash: contentHash('sha256:abc'),
  },
};
const fixturePage: WikiPageSummary = {
  id: pid,
  wikiId: wid,
  title: 'Q3 NRR',
  pageType: 'Metric',
  body: 'NRR was 110%.',
  citations: [cit],
};

const fakeWikiReader = (pages: WikiPageSummary[]): WikiReader => ({
  async searchPages() {
    return pages;
  },
  async listSamplePages() {
    return pages;
  },
  async getPage(id) {
    return pages.find((p) => p.id === id) ?? null;
  },
  async searchSources() {
    return [];
  },
  async listPagesByType({ pageType }) {
    return pages.filter((p) => p.pageType === pageType);
  },
  async getWikiMeta() {
    return null;
  },
});

/**
 * Returns a MockLanguageModelV3 whose `doStream` walks through the provided
 * stream-chunk arrays one per call. Each invocation of `doStream` (one per
 * agent step) consumes the next array. Lets us script tool-call → tool-result
 * → final-text loops in a couple of lines per test.
 *
 * Chunks are typed loosely (`Record<string, unknown>`) at the call site for
 * readability; the cast to `LanguageModelV3StreamPart`-shaped chunks happens
 * here so each test fixture stays compact.
 */
type Chunk = Record<string, unknown>;
const scriptedModel = (scripts: ReadonlyArray<ReadonlyArray<Chunk>>): LanguageModel => {
  let call = 0;
  type DoStreamResult = Awaited<ReturnType<MockLanguageModelV3['doStream']>>;
  const model = new MockLanguageModelV3({
    doStream: async () => {
      const chunks = scripts[Math.min(call, scripts.length - 1)] ?? [];
      call += 1;
      return {
        stream: simulateReadableStream({ chunks: [...chunks] }),
      } as unknown as DoStreamResult;
    },
  });
  return model as unknown as LanguageModel;
};

const finishStop = {
  type: 'finish',
  finishReason: { unified: 'stop', raw: undefined },
  logprobs: undefined,
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  },
};

const finishToolCalls = {
  ...finishStop,
  finishReason: { unified: 'tool-calls', raw: undefined },
};

describe('createAgenticResearcher', () => {
  it('returns empty findings when the model produces no tool calls', async () => {
    const reader = fakeWikiReader([]);
    const model = scriptedModel([
      [
        { type: 'text-start', id: 't' },
        { type: 'text-delta', id: 't', delta: 'nothing to look up' },
        { type: 'text-end', id: 't' },
        finishStop,
      ],
    ]);
    const researcher = createAgenticResearcher({
      model,
      wikiReader: reader,
      maxSteps: 2,
    });
    const out = await researcher.research({ wikiId: wid, question: 'Q?' });
    expect(out.pages).toEqual([]);
    expect(out.findings).toEqual([]);
  });

  it('runs searchWiki via tool call and turns each surfaced page into a finding', async () => {
    const reader = fakeWikiReader([fixturePage]);
    const visited: string[] = [];
    const model = scriptedModel([
      // Step 1: model decides to call searchWiki.
      [
        {
          type: 'tool-call',
          toolCallId: 'tc-1',
          toolName: 'searchWiki',
          input: JSON.stringify({ query: 'Q3 NRR' }),
        },
        finishToolCalls,
      ],
      // Step 2: model has the search result; finishes with a one-line summary.
      [
        { type: 'text-start', id: 't' },
        { type: 'text-delta', id: 't', delta: 'found one page' },
        { type: 'text-end', id: 't' },
        finishStop,
      ],
    ]);
    const researcher = createAgenticResearcher({
      model,
      wikiReader: reader,
      maxSteps: 4,
    });
    const out = await researcher.research({
      wikiId: wid,
      question: 'What was Q3 NRR?',
      onPageVisited: (p) => visited.push(p.title),
    });
    expect(out.pages).toHaveLength(1);
    expect(out.pages[0]?.id).toBe(pid);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]?.citations[0]?.id).toBe(cit.id);
    expect(visited).toEqual(['Q3 NRR']);
  });

  it('dedupes pages surfaced by both searchWiki and a follow-up readWikiPage', async () => {
    const reader = fakeWikiReader([fixturePage]);
    const visited: string[] = [];
    const model = scriptedModel([
      [
        {
          type: 'tool-call',
          toolCallId: 'tc-1',
          toolName: 'searchWiki',
          input: JSON.stringify({ query: 'Q3 NRR' }),
        },
        finishToolCalls,
      ],
      [
        {
          type: 'tool-call',
          toolCallId: 'tc-2',
          toolName: 'readWikiPage',
          input: JSON.stringify({ pageId: pid }),
        },
        finishToolCalls,
      ],
      [
        { type: 'text-start', id: 't' },
        { type: 'text-delta', id: 't', delta: 'confirmed' },
        { type: 'text-end', id: 't' },
        finishStop,
      ],
    ]);
    const researcher = createAgenticResearcher({
      model,
      wikiReader: reader,
      maxSteps: 5,
    });
    const out = await researcher.research({
      wikiId: wid,
      question: 'Q?',
      onPageVisited: (p) => visited.push(p.title),
    });
    // Two tool calls touched the same page → one finding, one onPageVisited.
    expect(out.pages).toHaveLength(1);
    expect(out.findings).toHaveLength(1);
    expect(visited).toEqual(['Q3 NRR']);
  });
});
