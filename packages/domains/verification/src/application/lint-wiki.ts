import { lintFindingId } from '@package/contracts/shared';
import type { Claim, LintRunId, WikiId, WikiPageId } from '@package/contracts/shared';
import { Correction } from '../domain/correction.ts';
import { LintFinding, type Verdict } from '../domain/lint-finding.ts';
import { LintRun, type RunningLintRun } from '../domain/lint-run.ts';
import { auditClaim } from './audit-claim.ts';
import type { LintRuntimeDeps } from './ports.ts';

export interface LintWikiResult {
  finishedAt: string;
  totalClaims: number;
  unsupportedCount: number;
  contradictedCount: number;
}

// Tally deltas per verdict, exhaustively. Adding a new verdict must light up
// here as a type error rather than silently miscount.
const tallyDelta = (
  verdict: Verdict,
): { auditedDelta: number; unsupportedDelta: number; contradictedDelta: number } => {
  switch (verdict) {
    case 'supported':
      return { auditedDelta: 1, unsupportedDelta: 0, contradictedDelta: 0 };
    case 'unsupported':
      return { auditedDelta: 1, unsupportedDelta: 1, contradictedDelta: 0 };
    case 'contradicted':
      return { auditedDelta: 1, unsupportedDelta: 0, contradictedDelta: 1 };
  }
};

// Orchestrates a LintRun over every Claim in a Wiki. Per-Claim audits run
// concurrently up to `deps.concurrency`. Each audit produces a LintFinding;
// findings are persisted as they complete, the LintRun's running tally is
// updated, and a ClaimAudited event is emitted for the SSE tape. On
// completion, a LintRunFinished event is emitted; if a per-claim audit
// rejects, that claim is recorded as an `unsupported` finding with a
// synthetic Correction so the run can complete deterministically — one bad
// claim must NEVER abort the entire run, otherwise persisted state diverges
// from the SSE tape (see PR #6 silent-failure-hunter finding 1).
export async function lintWiki(
  deps: LintRuntimeDeps,
  input: { lintRunId: LintRunId; wikiId: WikiId },
): Promise<LintWikiResult> {
  const startedAt = deps.now().toISOString();
  const all = await deps.claims.listClaimsForWiki(input.wikiId);

  const pending = LintRun.start({
    id: input.lintRunId,
    wikiId: input.wikiId,
    totalClaims: all.length,
    startedAt,
  });
  await deps.runs.insert(pending);
  await deps.emit({ kind: 'LintRunStarted', lintRunId: pending.id, totalClaims: all.length });
  let run: RunningLintRun = LintRun.run(pending);
  await deps.runs.update(run);

  const sem = createSemaphore(Math.max(1, deps.concurrency));
  await Promise.all(
    all.map(({ wikiPageId, claim }) =>
      sem(() => auditOneClaim(deps, input.lintRunId, wikiPageId, claim)).then(async (finding) => {
        await deps.findings.insertMany([finding]);
        run = LintRun.tally(run, tallyDelta(finding.verdict));
        await deps.runs.update(run);
        await deps.emit({
          kind: 'ClaimAudited',
          lintRunId: run.id,
          lintFindingId: finding.id,
          claimId: claim.id,
          wikiPageId,
          verdict: finding.verdict,
        });
      }),
    ),
  );

  const finishedAt = deps.now().toISOString();
  const finished = LintRun.finish(run, finishedAt);
  await deps.runs.update(finished);
  await deps.emit({
    kind: 'LintRunFinished',
    lintRunId: finished.id,
    unsupportedCount: finished.unsupportedCount,
    contradictedCount: finished.contradictedCount,
  });

  return {
    finishedAt,
    totalClaims: finished.totalClaims,
    unsupportedCount: finished.unsupportedCount,
    contradictedCount: finished.contradictedCount,
  };
}

// Audit a single claim with full failure isolation. Any rejection from
// auditClaim (Verifier transport error, source-text read error, schema
// validation failure, etc.) is converted into an `unsupported` LintFinding
// whose Correction.replacementText carries the error message — this keeps
// the LintRun's persisted state in sync with the emitted ClaimAudited event
// stream. See PR #6 silent-failure-hunter finding 1.
const auditOneClaim = async (
  deps: LintRuntimeDeps,
  lintRunId: LintRunId,
  wikiPageId: WikiPageId,
  claim: Claim,
): Promise<LintFinding> => {
  try {
    const out = await auditClaim(
      { verifier: deps.verifier, sourceText: deps.sourceText },
      { claim },
    );
    return buildFinding(deps, lintRunId, wikiPageId, claim, out);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return LintFinding.create({
      id: lintFindingId(deps.newId()),
      lintRunId,
      wikiPageId,
      claimId: claim.id,
      claim,
      verdict: 'unsupported',
      evidenceText: `audit failed: ${message.slice(0, 1900)}`,
      citedSpans: claim.citations,
      correction: Correction.create({
        replacementText: `Audit failed for this claim: ${message.slice(0, 1900)}`,
      }),
    });
  }
};

const buildFinding = (
  deps: LintRuntimeDeps,
  lintRunId: LintRunId,
  wikiPageId: WikiPageId,
  claim: Claim,
  out: { verdict: Verdict; evidenceText: string; correction?: Correction },
): LintFinding => {
  const id = lintFindingId(deps.newId());
  switch (out.verdict) {
    case 'supported':
      return LintFinding.create({
        id,
        lintRunId,
        wikiPageId,
        claimId: claim.id,
        claim,
        verdict: 'supported',
        evidenceText: out.evidenceText,
        citedSpans: claim.citations,
      });
    case 'unsupported':
    case 'contradicted': {
      // auditClaim guarantees a Correction for non-supported verdicts.
      if (!out.correction) {
        throw new Error(
          `auditClaim returned ${out.verdict} without a Correction (claim ${claim.id})`,
        );
      }
      return LintFinding.create({
        id,
        lintRunId,
        wikiPageId,
        claimId: claim.id,
        claim,
        verdict: out.verdict,
        evidenceText: out.evidenceText,
        citedSpans: claim.citations,
        correction: out.correction,
      });
    }
  }
};

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
