import { lintFindingId } from '@package/contracts/shared';
import type { LintRunId, WikiId } from '@package/contracts/shared';
import { LintFinding } from '../domain/lint-finding.ts';
import { LintRun } from '../domain/lint-run.ts';
import { auditClaim } from './audit-claim.ts';
import type { LintRuntimeDeps } from './ports.ts';

export interface LintWikiResult {
  finishedAt: string;
  totalClaims: number;
  unsupportedCount: number;
  contradictedCount: number;
}

// Orchestrates a LintRun over every Claim in a Wiki. Per-Claim audits run
// concurrently up to `deps.concurrency`. Each audit produces a LintFinding;
// findings are persisted as they complete, the LintRun's running tally is
// updated, and a ClaimAudited event is emitted for the SSE tape. On
// completion, a LintRunFinished event is emitted; on a fatal error before
// any claim is fanned out, LintRunFailed.
export async function lintWiki(
  deps: LintRuntimeDeps,
  input: { lintRunId: LintRunId; wikiId: WikiId },
): Promise<LintWikiResult> {
  const startedAt = deps.now().toISOString();
  const all = await deps.claims.listClaimsForWiki(input.wikiId);

  let run = LintRun.start({
    id: input.lintRunId,
    wikiId: input.wikiId,
    totalClaims: all.length,
    startedAt,
  });
  await deps.runs.insert(run);
  await deps.emit({ kind: 'LintRunStarted', lintRunId: run.id, totalClaims: all.length });
  run = LintRun.run(run);
  await deps.runs.update(run);

  const sem = createSemaphore(Math.max(1, deps.concurrency));
  await Promise.all(
    all.map(({ wikiPageId, claim }) =>
      sem(async () => {
        const out = await auditClaim(
          { verifier: deps.verifier, sourceText: deps.sourceText },
          { claim },
        );
        const finding = LintFinding.create({
          id: lintFindingId(deps.newId()),
          lintRunId: input.lintRunId,
          wikiPageId,
          claimId: claim.id,
          claim,
          verdict: out.verdict,
          evidenceText: out.evidenceText,
          citedSpans: claim.citations,
          correction: out.correction,
        });
        await deps.findings.insertMany([finding]);
        run = LintRun.tally(run, {
          auditedDelta: 1,
          unsupportedDelta: out.verdict === 'unsupported' ? 1 : 0,
          contradictedDelta: out.verdict === 'contradicted' ? 1 : 0,
        });
        await deps.runs.update(run);
        await deps.emit({
          kind: 'ClaimAudited',
          lintRunId: run.id,
          lintFindingId: finding.id,
          claimId: claim.id,
          wikiPageId,
          verdict: out.verdict,
        });
      }),
    ),
  );

  const finishedAt = deps.now().toISOString();
  run = LintRun.finish(run, finishedAt);
  await deps.runs.update(run);
  await deps.emit({
    kind: 'LintRunFinished',
    lintRunId: run.id,
    unsupportedCount: run.unsupportedCount,
    contradictedCount: run.contradictedCount,
  });

  return {
    finishedAt,
    totalClaims: run.totalClaims,
    unsupportedCount: run.unsupportedCount,
    contradictedCount: run.contradictedCount,
  };
}

const createSemaphore = (max: number) => {
  let active = 0;
  const queue: Array<() => void> = [];
  const acquire = (): Promise<void> =>
    new Promise((resolve) => {
      const tryGo = () => {
        if (active < max) {
          active++;
          resolve();
        } else {
          queue.push(tryGo);
        }
      };
      tryGo();
    });
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    await acquire();
    try {
      return await fn();
    } finally {
      active--;
      const next = queue.shift();
      next?.();
    }
  };
};
