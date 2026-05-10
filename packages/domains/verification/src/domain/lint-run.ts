import type { LintRunId, WikiId } from '@package/contracts/shared';

export type LintRunStatus = 'pending' | 'running' | 'finished' | 'failed';

export interface LintRun {
  readonly id: LintRunId;
  readonly wikiId: WikiId;
  readonly status: LintRunStatus;
  readonly totalClaims: number;
  readonly audited: number;
  readonly unsupportedCount: number;
  readonly contradictedCount: number;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly failureMessage?: string;
}

export const LintRun = {
  start(props: {
    id: LintRunId;
    wikiId: WikiId;
    totalClaims: number;
    startedAt: string;
  }): LintRun {
    return Object.freeze({
      ...props,
      status: 'pending' as const,
      audited: 0,
      unsupportedCount: 0,
      contradictedCount: 0,
    });
  },
  run(r: LintRun): LintRun {
    if (r.status !== 'pending') throw new Error(`cannot run from ${r.status}`);
    return Object.freeze({ ...r, status: 'running' as const });
  },
  tally(
    r: LintRun,
    delta: { auditedDelta: number; unsupportedDelta: number; contradictedDelta: number },
  ): LintRun {
    return Object.freeze({
      ...r,
      audited: r.audited + delta.auditedDelta,
      unsupportedCount: r.unsupportedCount + delta.unsupportedDelta,
      contradictedCount: r.contradictedCount + delta.contradictedDelta,
    });
  },
  finish(r: LintRun, at: string): LintRun {
    if (r.status !== 'running') throw new Error(`cannot finish from ${r.status}`);
    return Object.freeze({ ...r, status: 'finished' as const, endedAt: at });
  },
  fail(r: LintRun, message: string, at: string): LintRun {
    return Object.freeze({
      ...r,
      status: 'failed' as const,
      failureMessage: message,
      endedAt: at,
    });
  },
};
