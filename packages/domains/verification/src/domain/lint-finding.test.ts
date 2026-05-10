import { describe, expect, it } from 'bun:test';
import {
  citationId,
  claimId,
  contentHash,
  lintFindingId,
  lintRunId,
  sourceId,
  wikiPageId,
} from '@package/contracts/shared';
import { Correction } from './correction.ts';
import { LintFinding } from './lint-finding.ts';

const claim = {
  id: claimId('cccccccc-1111-4222-8333-444444444444'),
  wikiPageId: wikiPageId('dddddddd-1111-4222-8333-444444444444'),
  paragraphId: 'p-1',
  claimText: 'NRR was 110%',
  citations: [
    {
      id: citationId('aaaaaaaa-1111-4222-8333-444444444444'),
      label: 'metrics',
      span: {
        sourceId: sourceId('11111111-2222-4333-8444-000000000001'),
        byteRange: { start: 0, end: 50 },
        contentHash: contentHash('sha256:abc'),
      },
    },
  ],
};

describe('LintFinding', () => {
  it('a "supported" finding has no Correction', () => {
    const f = LintFinding.create({
      id: lintFindingId('88888888-2222-4333-8444-000000000001'),
      lintRunId: lintRunId('77777777-2222-4333-8444-555555555555'),
      wikiPageId: claim.wikiPageId,
      claimId: claim.id,
      claim,
      verdict: 'supported',
      evidenceText: 'matches.',
      citedSpans: claim.citations,
    });
    expect(f.correction).toBeUndefined();
    expect(f.resolvedAt).toBeUndefined();
  });

  it('"contradicted" findings MUST carry a Correction (runtime check defends against `as any` callers)', () => {
    // The discriminated-union type already requires `correction` for
    // contradicted/unsupported variants. This test asserts that the runtime
    // guard inside LintFinding.create still rejects callers that bypass the
    // type system.
    const bypass = LintFinding.create as unknown as (props: Record<string, unknown>) => unknown;
    expect(() =>
      bypass({
        id: lintFindingId('88888888-2222-4333-8444-000000000001'),
        lintRunId: lintRunId('77777777-2222-4333-8444-555555555555'),
        wikiPageId: claim.wikiPageId,
        claimId: claim.id,
        claim,
        verdict: 'contradicted',
        evidenceText: 'cited span says 105%.',
        citedSpans: claim.citations,
      }),
    ).toThrow(/Correction/);
  });

  it('"unsupported" findings accept a Correction', () => {
    const f = LintFinding.create({
      id: lintFindingId('88888888-2222-4333-8444-000000000002'),
      lintRunId: lintRunId('77777777-2222-4333-8444-555555555555'),
      wikiPageId: claim.wikiPageId,
      claimId: claim.id,
      claim,
      verdict: 'unsupported',
      evidenceText: 'cited span does not mention NRR.',
      citedSpans: claim.citations,
      correction: Correction.create({ replacementText: 'NRR was 105%.' }),
    });
    expect(f.correction?.replacementText).toBe('NRR was 105%.');
  });

  it('resolve stamps a resolvedAt without losing other fields', () => {
    const f = LintFinding.create({
      id: lintFindingId('88888888-2222-4333-8444-000000000003'),
      lintRunId: lintRunId('77777777-2222-4333-8444-555555555555'),
      wikiPageId: claim.wikiPageId,
      claimId: claim.id,
      claim,
      verdict: 'unsupported',
      evidenceText: 'no match.',
      citedSpans: claim.citations,
      correction: Correction.create({ replacementText: 'fix.' }),
    });
    const resolved = LintFinding.resolve(f, '2026-05-09T12:10:00.000Z');
    expect(resolved.resolvedAt).toBe('2026-05-09T12:10:00.000Z');
    expect(resolved.verdict).toBe('unsupported');
  });
});

describe('Correction', () => {
  it('rejects empty replacementText', () => {
    expect(() => Correction.create({ replacementText: '' })).toThrow(/1\.\.2000/);
  });

  it('rejects oversized replacementText', () => {
    expect(() => Correction.create({ replacementText: 'x'.repeat(2001) })).toThrow(/1\.\.2000/);
  });

  it('rejects oversized newCitationLabel', () => {
    expect(() =>
      Correction.create({ replacementText: 'fix.', newCitationLabel: 'x'.repeat(201) }),
    ).toThrow(/200 chars/);
  });
});
