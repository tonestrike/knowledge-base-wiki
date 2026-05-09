import { eventIterator, oc } from '@orpc/contract';
import { z } from 'zod';
import { ClaimId, LintFindingId, LintRunId, WikiId, WikiPageId } from '../shared/ids.ts';

export const Verdict = z.enum(['supported', 'unsupported', 'contradicted']);
export type Verdict = z.infer<typeof Verdict>;

export const Correction = z.object({
  replacementText: z.string().min(1).max(2000),
  newCitationLabel: z.string().min(1).max(200).optional(),
});
export type Correction = z.infer<typeof Correction>;

export const LintRunStatus = z.enum(['pending', 'running', 'finished', 'failed']);

export const LintRun = z.object({
  id: LintRunId,
  wikiId: WikiId,
  status: LintRunStatus,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  totalClaims: z.number().int().nonnegative(),
  audited: z.number().int().nonnegative(),
  unsupportedCount: z.number().int().nonnegative(),
  contradictedCount: z.number().int().nonnegative(),
});
export type LintRun = z.infer<typeof LintRun>;

export const StartLintInput = z.object({ wikiId: WikiId });
export const StartLintOutput = z.object({ lintRunId: LintRunId });

export const GetLintRunInput = z.object({ id: LintRunId });
export const ListLintRunsInput = z.object({
  wikiId: WikiId.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(50).default(20),
});
export const ListLintRunsOutput = z.object({
  items: z.array(LintRun),
  nextCursor: z.string().optional(),
});

export const LintRunStarted = z.object({
  kind: z.literal('LintRunStarted'),
  lintRunId: LintRunId,
  totalClaims: z.number().int().nonnegative(),
});
export const ClaimAudited = z.object({
  kind: z.literal('ClaimAudited'),
  lintRunId: LintRunId,
  lintFindingId: LintFindingId,
  claimId: ClaimId,
  wikiPageId: WikiPageId,
  verdict: Verdict,
});
export const LintRunFinished = z.object({
  kind: z.literal('LintRunFinished'),
  lintRunId: LintRunId,
  unsupportedCount: z.number().int().nonnegative(),
  contradictedCount: z.number().int().nonnegative(),
});
export const LintRunFailed = z.object({
  kind: z.literal('LintRunFailed'),
  lintRunId: LintRunId,
  message: z.string(),
});

export const LintEvent = z.discriminatedUnion('kind', [
  LintRunStarted,
  ClaimAudited,
  LintRunFinished,
  LintRunFailed,
]);
export type LintEvent = z.infer<typeof LintEvent>;

export const StreamLintInput = z.object({ lintRunId: LintRunId });

export const lintsContract = {
  start: oc
    .route({ method: 'POST', path: '/lint-runs' })
    .input(StartLintInput)
    .output(StartLintOutput),
  getLintRun: oc
    .route({ method: 'GET', path: '/lint-runs/{id}' })
    .input(GetLintRunInput)
    .output(LintRun),
  listLintRuns: oc
    .route({ method: 'GET', path: '/lint-runs' })
    .input(ListLintRunsInput)
    .output(ListLintRunsOutput),
  streamLintEvents: oc
    .route({ method: 'GET', path: '/lint-runs/{lintRunId}/events' })
    .input(StreamLintInput)
    .output(eventIterator(LintEvent)),
};
