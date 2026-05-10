import { describe, expect, it } from 'bun:test';
import { citationId, contentHash, sourceId, wikiId, wikiPageId } from '@package/contracts/shared';
import type { Citation } from '@package/contracts/shared';
import type { WikiReader } from './ports.ts';
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

const wikiReader = (citations: Citation[] = [cit]): WikiReader => ({
  async searchPages() {
    return [
      {
        id: pid,
        wikiId: wid,
        title: 'Q3 NRR',
        pageType: 'Metric',
        body: 'NRR was 110%.',
        citations,
      },
    ];
  },
  async listSamplePages() {
    return [];
  },
  async getPage() {
    return null;
  },
});

describe('researchQuestion', () => {
  it('returns each ranked wiki page as one finding with its citations attached', async () => {
    const out = await researchQuestion(
      { wikiReader: wikiReader([cit]) },
      { wikiId: wid, question: 'What was Q3 NRR?' },
    );
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]?.citations).toHaveLength(1);
    expect(out.findings[0]?.citations[0]?.id).toBe(cid);
    expect(out.findings[0]?.quoteText).toBe('NRR was 110%.');
  });

  it('returns no findings when the wiki has no candidate pages', async () => {
    const emptyReader: WikiReader = {
      async searchPages() {
        return [];
      },
      async listSamplePages() {
        return [];
      },
      async getPage() {
        return null;
      },
    };
    const out = await researchQuestion(
      { wikiReader: emptyReader },
      { wikiId: wid, question: 'Q?' },
    );
    expect(out.findings).toHaveLength(0);
    expect(out.pages).toHaveLength(0);
  });

  it('falls back to a wiki sample as suggestion pages when nothing matched', async () => {
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
    };
    const out = await researchQuestion(
      { wikiReader: fallbackReader },
      { wikiId: wid, question: 'totally unrelated question' },
    );
    expect(out.findings).toHaveLength(0);
    expect(out.suggestionPages).toHaveLength(1);
    expect(out.suggestionPages?.[0]?.title).toBe('Pricing tiers');
  });
});
