import { describe, expect, it } from 'bun:test';
import { citationId, claimId, sourceId, wikiPageId } from '@package/contracts/shared';
import { auditClaim } from './audit-claim.ts';
import type { AnthropicVerifier, SourceTextReader } from './ports.ts';

const claim = {
  id: claimId('cccccccc-1111-4222-8333-444444444444'),
  wikiPageId: wikiPageId('dddddddd-1111-4222-8333-444444444444'),
  paragraphId: 'p-1',
  claimText: 'Q3 NRR was 110%',
  citations: [
    {
      id: citationId('aaaaaaaa-1111-4222-8333-444444444444'),
      label: 'metrics deck',
      span: {
        sourceId: sourceId('11111111-2222-4333-8444-000000000001'),
        byteRange: { start: 0, end: 50 },
        contentHash: 'sha256:abc',
      },
    },
  ],
};

describe('auditClaim', () => {
  it('reads cited slices from the SourceTextReader and forwards them to the Verifier', async () => {
    const seenRanges: Array<{ start: number; end: number }> = [];
    const reader: SourceTextReader = {
      readSlice: async ({ byteRange }) => {
        seenRanges.push(byteRange);
        return `slice ${byteRange.start}-${byteRange.end}`;
      },
    };
    let forwarded: ReadonlyArray<{ citationId: string; sliceText: string }> = [];
    const verifier: AnthropicVerifier = {
      audit: async ({ citedSlices }) => {
        forwarded = citedSlices;
        return { verdict: 'supported', evidenceText: citedSlices[0]?.sliceText ?? '' };
      },
    };
    const out = await auditClaim({ verifier, sourceText: reader }, { claim });
    expect(out.verdict).toBe('supported');
    expect(seenRanges).toEqual([{ start: 0, end: 50 }]);
    expect(forwarded[0]?.sliceText).toBe('slice 0-50');
    expect(out.correction).toBeUndefined();
  });

  it('throws CitationUnreadableError when SourceTextReader returns null (rather than feeding the Verifier a sentinel)', async () => {
    const reader: SourceTextReader = { readSlice: async () => null };
    let auditCalled = 0;
    const verifier: AnthropicVerifier = {
      audit: async () => {
        auditCalled++;
        return { verdict: 'supported', evidenceText: 'ok' };
      },
    };
    await expect(auditClaim({ verifier, sourceText: reader }, { claim })).rejects.toThrow(
      /unreadable/,
    );
    expect(auditCalled).toBe(0);
  });

  it('demands a Correction for non-supported verdicts (Verifier MUST provide one)', async () => {
    const reader: SourceTextReader = { readSlice: async () => 'cited says 105%' };
    const verifier: AnthropicVerifier = {
      audit: async () => ({ verdict: 'contradicted', evidenceText: 'mismatch' }),
    };
    await expect(auditClaim({ verifier, sourceText: reader }, { claim })).rejects.toThrow(
      /Correction/,
    );
  });

  it('returns "unsupported" with the Correction when present', async () => {
    const reader: SourceTextReader = { readSlice: async () => 'cited says 105%' };
    const verifier: AnthropicVerifier = {
      audit: async () => ({
        verdict: 'unsupported',
        evidenceText: 'no NRR mention here',
        correction: {
          replacementText: 'Q3 NRR was 105%.',
          newCitationLabel: 'metrics deck slide 7',
        },
      }),
    };
    const out = await auditClaim({ verifier, sourceText: reader }, { claim });
    expect(out.verdict).toBe('unsupported');
    expect(out.correction?.replacementText).toBe('Q3 NRR was 105%.');
    expect(out.correction?.newCitationLabel).toBe('metrics deck slide 7');
  });

  it('returns "contradicted" with the Correction when the Verifier provides one', async () => {
    const reader: SourceTextReader = { readSlice: async () => 'cited says 105%' };
    const verifier: AnthropicVerifier = {
      audit: async () => ({
        verdict: 'contradicted',
        evidenceText: 'cited slice asserts 105%',
        correction: { replacementText: 'Q3 NRR was 105%.' },
      }),
    };
    const out = await auditClaim({ verifier, sourceText: reader }, { claim });
    expect(out.verdict).toBe('contradicted');
    expect(out.correction?.replacementText).toBe('Q3 NRR was 105%.');
  });
});
