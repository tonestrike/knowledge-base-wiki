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

export interface LintFinding {
  readonly id: LintFindingId;
  readonly lintRunId: LintRunId;
  readonly wikiPageId: WikiPageId;
  readonly claimId: ClaimId;
  readonly claim: Claim;
  readonly verdict: Verdict;
  readonly evidenceText: string;
  readonly citedSpans: ReadonlyArray<Citation>;
  readonly correction?: Correction;
  readonly resolvedAt?: string;
}

export const LintFinding = {
  create(props: Omit<LintFinding, 'resolvedAt'>): LintFinding {
    if (
      (props.verdict === 'unsupported' || props.verdict === 'contradicted') &&
      !props.correction
    ) {
      throw new Error('non-supported verdicts must carry a Correction');
    }
    return Object.freeze({
      ...props,
      citedSpans: Object.freeze([...props.citedSpans]),
    });
  },
  resolve(f: LintFinding, at: string): LintFinding {
    return Object.freeze({ ...f, resolvedAt: at });
  },
};
