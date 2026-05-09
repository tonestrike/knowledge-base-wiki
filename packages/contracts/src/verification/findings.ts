import { oc } from '@orpc/contract';
import { z } from 'zod';
import { Citation } from '../shared/citation.ts';
import { Claim } from '../shared/claim.ts';
import { ClaimId, LintFindingId, LintRunId, WikiPageId } from '../shared/ids.ts';
import { Correction, Verdict } from './lints.ts';

export const LintFinding = z.object({
  id: LintFindingId,
  lintRunId: LintRunId,
  wikiPageId: WikiPageId,
  claimId: ClaimId,
  claim: Claim,
  verdict: Verdict,
  evidenceText: z.string(),
  citedSpans: z.array(Citation),
  correction: Correction.optional(),
  resolvedAt: z.string().datetime().optional(),
});
export type LintFinding = z.infer<typeof LintFinding>;

export const ListFindingsInput = z.object({
  lintRunId: LintRunId,
  verdict: Verdict.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export const ListFindingsOutput = z.object({
  items: z.array(LintFinding),
  nextCursor: z.string().optional(),
});

export const GetFindingInput = z.object({ id: LintFindingId });

export const ApplyCorrectionInput = z.object({
  lintFindingId: LintFindingId,
});
export const ApplyCorrectionOutput = z.object({
  appliedAt: z.string().datetime(),
});

export const findingsContract = {
  getFinding: oc
    .route({ method: 'GET', path: '/lint-findings/{id}' })
    .input(GetFindingInput)
    .output(LintFinding),
  listFindings: oc
    .route({ method: 'GET', path: '/lint-findings' })
    .input(ListFindingsInput)
    .output(ListFindingsOutput),
  applyCorrection: oc
    .route({ method: 'POST', path: '/lint-findings/{lintFindingId}/apply' })
    .input(ApplyCorrectionInput)
    .output(ApplyCorrectionOutput),
};
