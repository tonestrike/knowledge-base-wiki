import { describe, expect, it } from 'bun:test';
import { citationId, contentHash, sourceId, wikiId, wikiPageId } from '@package/contracts/shared';
import type { Citation } from '@package/contracts/shared';
import type { Researcher, WikiPageSummary, WikiReader } from './ports.ts';
import { researchQuestion } from './research-question.ts';

const wid = wikiId('44444444-2222-4333-8444-555555555555');
const pid = wikiPageId('dddddddd-1111-4222-8333-444444444444');
const cid = citationId('aaaaaaaa-1111-4222-8333-444444444444');

const cit: Citation = {
  id: cid,
  label: 'metrics deck',
  span: {
    sourceId: sourceId('11111111-2222-4333-8444-000000000001'),
    byteRange: { start: 0, end: 50 },
    contentHash: contentHash('sha256:abc'),
  },
};

const fakePage: WikiPageSummary = {
  id: pid,
  wikiId: wid,
  title: 'Q3 NRR',
  pageType: 'Metric',
  body: 'NRR was 110%.',
  citations: [cit],
};

const noopReader: WikiReader = {
  async searchPages() {
    return [];
  },
  async listSamplePages() {
    return [];
  },
  async getPage() {
    return null;
  },
  async searchSources() {
    return [];
  },
  async listPagesByType() {
    return [];
  },
  async getWikiMeta() {
    return null;
  },
};

const stubResearcherWithPages = (pages: WikiPageSummary[]): Researcher => ({
  async research(input) {
    input.onPartial?.({ findings: pages.length });
    for (const p of pages) input.onPageVisited?.(p);
    return {
      pages,
      findings: pages.map((p) => ({
        wikiPageId: p.id,
        quoteText: p.body,
        citationIds: p.citations.map((c) => c.id),
        citations: p.citations,
      })),
    };
  },
});

const emptyResearcher: Researcher = {
  async research() {
    return { pages: [], findings: [] };
  },
};

describe('researchQuestion', () => {
  it('returns whatever the Researcher port produced', async () => {
    const out = await researchQuestion(
      { researcher: stubResearcherWithPages([fakePage]), wikiReader: noopReader },
      { wikiId: wid, question: 'What was Q3 NRR?' },
    );
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]?.citations).toHaveLength(1);
    expect(out.findings[0]?.citations[0]?.id).toBe(cid);
    expect(out.findings[0]?.quoteText).toBe('NRR was 110%.');
  });

  it('forwards onPartial and onPageVisited callbacks to the Researcher', async () => {
    const findingTicks: number[] = [];
    const visited: string[] = [];
    await researchQuestion(
      { researcher: stubResearcherWithPages([fakePage]), wikiReader: noopReader },
      {
        wikiId: wid,
        question: 'Q?',
        onPartial: ({ findings }) => findingTicks.push(findings),
        onPageVisited: (p) => visited.push(p.title),
      },
    );
    expect(findingTicks).toEqual([1]);
    expect(visited).toEqual(['Q3 NRR']);
  });

  it('falls back to a wiki sample when the Researcher returns no findings and no suggestions', async () => {
    const samplePid = wikiPageId('eeeeeeee-1111-4222-8333-555555555555');
    const fallbackReader: WikiReader = {
      async searchPages() {
        return [];
      },
      async listSamplePages() {
        return [
          {
            id: samplePid,
            wikiId: wid,
            title: 'Pricing tiers',
            pageType: 'Concept',
            body: 'We have three tiers…',
            citations: [cit],
          },
        ];
      },
      async getPage() {
        return null;
      },
      async searchSources() {
        return [];
      },
      async listPagesByType() {
        return [];
      },
      async getWikiMeta() {
        return null;
      },
    };
    const out = await researchQuestion(
      { researcher: emptyResearcher, wikiReader: fallbackReader },
      { wikiId: wid, question: 'totally unrelated question' },
    );
    expect(out.findings).toHaveLength(0);
    expect(out.suggestionPages).toHaveLength(1);
    expect(out.suggestionPages?.[0]?.title).toBe('Pricing tiers');
  });

  it('respects suggestionPages already supplied by the Researcher (no double-fetch)', async () => {
    let listSampleCalls = 0;
    const reader: WikiReader = {
      ...noopReader,
      async listSamplePages() {
        listSampleCalls += 1;
        return [];
      },
    };
    const researcher: Researcher = {
      async research() {
        return { pages: [], findings: [], suggestionPages: [fakePage] };
      },
    };
    const out = await researchQuestion(
      { researcher, wikiReader: reader },
      { wikiId: wid, question: 'Q?' },
    );
    expect(out.suggestionPages).toHaveLength(1);
    expect(listSampleCalls).toBe(0);
  });
});
