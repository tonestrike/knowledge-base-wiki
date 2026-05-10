import type {
  Citation,
  Claim,
  ClaimId,
  LintFindingId,
  LintRunId,
  WikiPageId,
} from '@package/contracts/shared';
import type { Correction } from './correction.ts';

export type Verdict = 'supported' | 'unsupported' | 'contradicted';

// Common shape across every variant. The discriminator is `verdict`.
interface LintFindingBase {
  readonly id: LintFindingId;
  readonly lintRunId: LintRunId;
  readonly wikiPageId: WikiPageId;
  readonly claimId: ClaimId;
  readonly claim: Claim;
  readonly evidenceText: string;
  readonly citedSpans: ReadonlyArray<Citation>;
  readonly resolvedAt?: string;
}

export interface SupportedFinding extends LintFindingBase {
  readonly verdict: 'supported';
  readonly correction?: undefined;
}

export interface UnsupportedFinding extends LintFindingBase {
  readonly verdict: 'unsupported';
  readonly correction: Correction;
}

export interface ContradictedFinding extends LintFindingBase {
  readonly verdict: 'contradicted';
  readonly correction: Correction;
}

export type LintFinding = SupportedFinding | UnsupportedFinding | ContradictedFinding;

type LintFindingCreateInput =
  | (Omit<SupportedFinding, 'resolvedAt' | 'correction'> & { correction?: undefined })
  | Omit<UnsupportedFinding, 'resolvedAt'>
  | Omit<ContradictedFinding, 'resolvedAt'>;

const freezeFinding = <T extends LintFinding>(props: T): T => {
  const frozen = {
    ...props,
    citedSpans: Object.freeze([...props.citedSpans]),
  } as T;
  return Object.freeze(frozen);
};

export const LintFinding = {
  create(props: LintFindingCreateInput): LintFinding {
    switch (props.verdict) {
      case 'supported':
        return freezeFinding({
          id: props.id,
          lintRunId: props.lintRunId,
          wikiPageId: props.wikiPageId,
          claimId: props.claimId,
          claim: props.claim,
          evidenceText: props.evidenceText,
          citedSpans: props.citedSpans,
          verdict: 'supported',
        });
      case 'unsupported':
      case 'contradicted':
        if (!props.correction) {
          // Belt-and-braces — the type already requires `correction` for these
          // variants; this guard catches callers that bypass the type via `any`.
          throw new Error('non-supported verdicts must carry a Correction');
        }
        return freezeFinding({
          id: props.id,
          lintRunId: props.lintRunId,
          wikiPageId: props.wikiPageId,
          claimId: props.claimId,
          claim: props.claim,
          evidenceText: props.evidenceText,
          citedSpans: props.citedSpans,
          verdict: props.verdict,
          correction: props.correction,
        });
    }
  },
  resolve(f: LintFinding, at: string): LintFinding {
    return freezeFinding({ ...f, resolvedAt: at });
  },
};
