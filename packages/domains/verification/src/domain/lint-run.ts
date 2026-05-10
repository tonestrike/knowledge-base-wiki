import type { LintRunId, WikiId } from '@package/contracts/shared';

export type LintRunStatus = 'pending' | 'running' | 'finished' | 'failed';

interface LintRunBase {
  readonly id: LintRunId;
  readonly wikiId: WikiId;
  readonly totalClaims: number;
  readonly audited: number;
  readonly unsupportedCount: number;
  readonly contradictedCount: number;
  readonly startedAt: string;
}

export interface PendingLintRun extends LintRunBase {
  readonly status: 'pending';
  readonly endedAt?: undefined;
  readonly failureMessage?: undefined;
}

export interface RunningLintRun extends LintRunBase {
  readonly status: 'running';
  readonly endedAt?: undefined;
  readonly failureMessage?: undefined;
}

export interface FinishedLintRun extends LintRunBase {
  readonly status: 'finished';
  readonly endedAt: string;
  readonly failureMessage?: undefined;
}

export interface FailedLintRun extends LintRunBase {
  readonly status: 'failed';
  readonly endedAt: string;
  readonly failureMessage: string;
}

export type LintRun = PendingLintRun | RunningLintRun | FinishedLintRun | FailedLintRun;

// States that may legally fail. A run that has already finished or failed is a
// terminal state and `fail` is a programmer error against it.
export type FailableLintRun = PendingLintRun | RunningLintRun;

export const LintRun = {
  start(props: {
    id: LintRunId;
    wikiId: WikiId;
    totalClaims: number;
    startedAt: string;
  }): PendingLintRun {
    return Object.freeze({
      ...props,
      status: 'pending' as const,
      audited: 0,
      unsupportedCount: 0,
      contradictedCount: 0,
    });
  },
  run(r: LintRun): RunningLintRun {
    if (r.status !== 'pending') throw new Error(`cannot run from ${r.status}`);
    return Object.freeze({
      id: r.id,
      wikiId: r.wikiId,
      totalClaims: r.totalClaims,
      audited: r.audited,
      unsupportedCount: r.unsupportedCount,
      contradictedCount: r.contradictedCount,
      startedAt: r.startedAt,
      status: 'running' as const,
    });
  },
  tally<T extends PendingLintRun | RunningLintRun>(
    r: T,
    delta: { auditedDelta: number; unsupportedDelta: number; contradictedDelta: number },
  ): T {
    const next = {
      ...r,
      audited: r.audited + delta.auditedDelta,
      unsupportedCount: r.unsupportedCount + delta.unsupportedDelta,
      contradictedCount: r.contradictedCount + delta.contradictedDelta,
    } as T;
    return Object.freeze(next);
  },
  finish(r: LintRun, at: string): FinishedLintRun {
    if (r.status !== 'running') throw new Error(`cannot finish from ${r.status}`);
    return Object.freeze({
      id: r.id,
      wikiId: r.wikiId,
      totalClaims: r.totalClaims,
      audited: r.audited,
      unsupportedCount: r.unsupportedCount,
      contradictedCount: r.contradictedCount,
      startedAt: r.startedAt,
      status: 'finished' as const,
      endedAt: at,
    });
  },
  // Narrows input to states that may legally fail (pending or running). A
  // finished or failed run is terminal — calling fail() on it is a bug.
  fail(r: FailableLintRun, message: string, at: string): FailedLintRun {
    return Object.freeze({
      id: r.id,
      wikiId: r.wikiId,
      totalClaims: r.totalClaims,
      audited: r.audited,
      unsupportedCount: r.unsupportedCount,
      contradictedCount: r.contradictedCount,
      startedAt: r.startedAt,
      status: 'failed' as const,
      failureMessage: message,
      endedAt: at,
    });
  },
};
