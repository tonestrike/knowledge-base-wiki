import { describe, expect, it } from 'bun:test';
import { Claim } from './claim.ts';
import { citationId, claimId, sourceId, wikiPageId } from './ids.ts';

describe('Claim', () => {
  it('parses a claim with its paragraph anchor and citations', () => {
    const c = Claim.parse({
      id: claimId('cccccccc-1111-4222-8333-444444444444'),
      wikiPageId: wikiPageId('dddddddd-1111-4222-8333-444444444444'),
      paragraphId: 'p-3',
      claimText: 'Q3 NRR was 110%.',
      citations: [
        {
          id: citationId('aaaaaaaa-1111-4222-8333-444444444444'),
          label: 'Q3 board minutes',
          span: {
            sourceId: sourceId('11111111-2222-4333-8444-555555555555'),
            byteRange: { start: 0, end: 50 },
            contentHash: 'sha256:abc',
          },
        },
      ],
    });
    expect(c.citations).toHaveLength(1);
    expect(c.claimText).toContain('Q3 NRR');
  });

  it('rejects a claim with zero citations', () => {
    expect(() =>
      Claim.parse({
        id: claimId('cccccccc-1111-4222-8333-444444444444'),
        wikiPageId: wikiPageId('dddddddd-1111-4222-8333-444444444444'),
        paragraphId: 'p-3',
        claimText: 'uncited',
        citations: [],
      }),
    ).toThrow(/at least one citation/);
  });
});
