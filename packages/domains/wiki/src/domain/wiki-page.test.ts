import { describe, expect, it } from 'bun:test';
import { citationId, claimId, sourceId, wikiId, wikiPageId } from '@package/contracts/shared';
import { WikiPage } from './wiki-page.ts';

const sampleClaim = {
  id: claimId('cccccccc-1111-4222-8333-444444444444'),
  wikiPageId: wikiPageId('dddddddd-1111-4222-8333-444444444444'),
  paragraphId: 'p-1',
  claimText: 'EMEA approved.',
  citations: [
    {
      id: citationId('aaaaaaaa-1111-4222-8333-444444444444'),
      label: 'Q3 minutes',
      span: {
        sourceId: sourceId('11111111-2222-4333-8444-000000000001'),
        byteRange: { start: 0, end: 50 },
        contentHash: 'sha256:abc',
      },
    },
  ],
};

describe('WikiPage', () => {
  it('Concept pages must declare a pageType', () => {
    expect(() =>
      WikiPage.concept({
        id: wikiPageId('dddddddd-1111-4222-8333-444444444444'),
        wikiId: wikiId('44444444-2222-4333-8444-555555555555'),
        pageType: '',
        slug: 'foo',
        title: 'Foo',
        body: 'b',
        claims: [sampleClaim],
        updatedAt: '2026-05-09T12:00:00.000Z',
      }),
    ).toThrow(/pageType/);
  });

  it('Summary pages carry a sourceId, not a pageType requirement', () => {
    const p = WikiPage.summary({
      id: wikiPageId('dddddddd-1111-4222-8333-444444444444'),
      wikiId: wikiId('44444444-2222-4333-8444-555555555555'),
      sourceId: sourceId('11111111-2222-4333-8444-000000000001'),
      slug: 'q3-minutes',
      title: 'Q3 board minutes',
      body: 'b',
      claims: [sampleClaim],
      updatedAt: '2026-05-09T12:00:00.000Z',
    });
    expect(p.subtype).toBe('Summary');
    expect(p.sourceId).toBe(sourceId('11111111-2222-4333-8444-000000000001'));
  });

  it('Index pages aggregate refs and require at least one entry', () => {
    expect(() =>
      WikiPage.index({
        id: wikiPageId('dddddddd-1111-4222-8333-444444444444'),
        wikiId: wikiId('44444444-2222-4333-8444-555555555555'),
        pageType: 'Decision',
        slug: 'index-decision',
        title: 'Decisions',
        entries: [],
        updatedAt: '2026-05-09T12:00:00.000Z',
      }),
    ).toThrow(/at least one entry/);
  });

  it('Concept pages dedupe citations from the claim set', () => {
    const p = WikiPage.concept({
      id: wikiPageId('dddddddd-1111-4222-8333-444444444444'),
      wikiId: wikiId('44444444-2222-4333-8444-555555555555'),
      pageType: 'Decision',
      slug: 's',
      title: 't',
      body: 'b',
      claims: [sampleClaim, sampleClaim],
      updatedAt: '2026-05-09T12:00:00.000Z',
    });
    expect(p.citations).toHaveLength(1);
  });
});
