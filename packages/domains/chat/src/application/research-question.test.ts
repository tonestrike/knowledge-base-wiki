import { describe, expect, it } from 'bun:test';
import { citationId, sourceId, wikiId, wikiPageId } from '@package/contracts/shared';
import type { Citation } from '@package/contracts/shared';
import type { Researcher, WikiReader } from './ports.ts';
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
    contentHash: 'sha256:abc',
  },
};

const wikiReader = (): WikiReader => ({
  async searchPages() {
    return [
      {
        id: pid,
        wikiId: wid,
        title: 'Q3 NRR',
        pageType: 'Metric',
        body: 'NRR was 110%.',
        citations: [cit],
      },
    ];
  },
  async getPage() {
    return null;
  },
});

const researcherOf = (citationIds: string[]): Researcher => ({
  async research() {
    return {
      pages: [
        {
          id: pid,
          wikiId: wid,
          title: 'Q3 NRR',
          pageType: 'Metric',
          body: 'NRR was 110%.',
          citations: [cit],
        },
      ],
      findings: [
        {
          wikiPageId: pid,
          quoteText: 'NRR was 110%.',
          citationIds,
          citations: [],
        },
      ],
    };
  },
});

describe('researchQuestion', () => {
  it('resolves citation ids against the candidate pages', async () => {
    const out = await researchQuestion(
      { researcher: researcherOf([cid]), wikiReader: wikiReader() },
      { wikiId: wid, question: 'What was Q3 NRR?' },
    );
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]?.citations).toHaveLength(1);
    expect(out.findings[0]?.citations[0]?.id).toBe(cid);
  });

  it('drops findings whose citation ids are unknown to the candidate pages', async () => {
    const out = await researchQuestion(
      {
        researcher: researcherOf(['00000000-0000-4000-8000-000000000000']),
        wikiReader: wikiReader(),
      },
      { wikiId: wid, question: 'Q?' },
    );
    expect(out.findings).toHaveLength(0);
  });
});
