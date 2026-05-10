import { describe, expect, it } from 'bun:test';
import { type Claim, citationId, claimId, sourceId, wikiPageId } from '@package/contracts/shared';
import { auditClaim } from './audit-claim.ts';
import type { AnthropicVerifier, SourceTextReader } from './ports.ts';

// The planted contradiction from the 1.A risk-spike report. These exact
// strings produced 10/10 "contradicted" verdicts on claude-opus-4-7 at
// temperature 0 (spec §5.1.1).
const PLANTED_CLAIM: Claim = {
  id: claimId('cccccccc-1111-4222-8333-444444444444'),
  wikiPageId: wikiPageId('dddddddd-1111-4222-8333-444444444444'),
  paragraphId: 'p-1',
  claimText: 'Q3 NRR was 110%, exceeding the 106% target.',
  citations: [
    {
      id: citationId('aaaaaaaa-1111-4222-8333-444444444444'),
      label: 'Q3 metrics deck, slide 7',
      span: {
        sourceId: sourceId('11111111-2222-4333-8444-000000000099'),
        byteRange: { start: 0, end: 200 },
        contentHash: 'sha256:planted',
      },
    },
  ],
};

const PLANTED_CITED_TEXT =
  'Q3 NRR landed at 105%, four points below the 109% target. The board flagged this as a watch-item.';

const RUN_LIVE = process.env.RUN_DETERMINISM_TESTS === '1';
const TRIALS = 10;

describe('Verifier determinism on the planted contradiction', () => {
  // Default CI path: replay a recorded 10-trial run captured against
  // claude-opus-4-7 at temperature 0 on the 1.A spike. Asserts that the
  // production prompt + claim shape, when fed the canonical recorded verdicts,
  // produces 10/10 non-supported verdicts. This proves the wiring; the live
  // path below proves the model.
  it('catches the planted NRR=110% / cited-says-105% contradiction in 10/10 recorded trials', async () => {
    const recordedVerdicts: Array<{
      verdict: 'supported' | 'unsupported' | 'contradicted';
      evidenceText: string;
      correction: { replacementText: string };
    }> = Array.from({ length: TRIALS }).map(() => ({
      verdict: 'contradicted',
      evidenceText: 'Q3 NRR landed at 105%, four points below the 109% target.',
      correction: { replacementText: 'Q3 NRR was 105%, missing the 109% target.' },
    }));

    let trial = 0;
    const verifier: AnthropicVerifier = {
      audit: async () => {
        const v = recordedVerdicts[trial++];
        if (!v) throw new Error(`out of recorded trials at ${trial}`);
        return v;
      },
    };
    const reader: SourceTextReader = { readSlice: async () => PLANTED_CITED_TEXT };

    const verdicts: string[] = [];
    for (let i = 0; i < TRIALS; i++) {
      const out = await auditClaim({ verifier, sourceText: reader }, { claim: PLANTED_CLAIM });
      verdicts.push(out.verdict);
    }
    const caught = verdicts.filter((v) => v !== 'supported').length;
    expect(caught).toBe(TRIALS);
  });

  // Live path: makes 10 real Verifier calls (~$0.27/run). Gated behind
  // RUN_DETERMINISM_TESTS=1 so CI does not bleed budget on every push.
  it.skipIf(!RUN_LIVE)(
    'catches the planted contradiction live on claude-opus-4-7 in 10/10 trials',
    async () => {
      const apiKey = process.env.OPEN_ROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error(
          'OPEN_ROUTER_API_KEY must be set to run live determinism probe (RUN_DETERMINISM_TESTS=1)',
        );
      }
      const { createAnthropicVerifier } = await import('../infrastructure/anthropic-verifier.ts');
      const verifier = createAnthropicVerifier({ apiKey });
      const reader: SourceTextReader = { readSlice: async () => PLANTED_CITED_TEXT };

      const verdicts: string[] = [];
      for (let i = 0; i < TRIALS; i++) {
        const out = await auditClaim({ verifier, sourceText: reader }, { claim: PLANTED_CLAIM });
        verdicts.push(out.verdict);
      }
      const caught = verdicts.filter((v) => v !== 'supported').length;
      expect(caught).toBe(TRIALS);
    },
    180_000,
  );
});
