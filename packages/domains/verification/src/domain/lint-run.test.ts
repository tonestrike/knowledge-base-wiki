import { describe, expect, it } from 'bun:test';
import { lintRunId, wikiId } from '@package/contracts/shared';
import { LintRun } from './lint-run.ts';

describe('LintRun', () => {
  const id = lintRunId('77777777-2222-4333-8444-555555555555');
  const wid = wikiId('44444444-2222-4333-8444-555555555555');

  it('starts pending, advances through running → finished', () => {
    const pending = LintRun.start({
      id,
      wikiId: wid,
      totalClaims: 47,
      startedAt: '2026-05-09T12:05:00.000Z',
    });
    expect(pending.status).toBe('pending');
    const running = LintRun.run(pending);
    expect(running.status).toBe('running');
    const tallied = LintRun.tally(running, {
      auditedDelta: 1,
      unsupportedDelta: 0,
      contradictedDelta: 0,
    });
    expect(tallied.audited).toBe(1);
    const finished = LintRun.finish(tallied, '2026-05-09T12:06:30.000Z');
    expect(finished.status).toBe('finished');
    expect(finished.endedAt).toBe('2026-05-09T12:06:30.000Z');
  });

  it('refuses to run twice', () => {
    const r = LintRun.start({
      id,
      wikiId: wid,
      totalClaims: 0,
      startedAt: '2026-05-09T12:05:00.000Z',
    });
    const running = LintRun.run(r);
    expect(() => LintRun.run(running)).toThrow(/cannot run from running/);
  });

  it('refuses to finish from pending', () => {
    const r = LintRun.start({
      id,
      wikiId: wid,
      totalClaims: 0,
      startedAt: '2026-05-09T12:05:00.000Z',
    });
    expect(() => LintRun.finish(r, '2026-05-09T12:06:00.000Z')).toThrow(/cannot finish/);
  });

  it('can fail at any time', () => {
    const r = LintRun.start({
      id,
      wikiId: wid,
      totalClaims: 0,
      startedAt: '2026-05-09T12:05:00.000Z',
    });
    const failed = LintRun.fail(r, 'no claims', '2026-05-09T12:05:30.000Z');
    expect(failed.status).toBe('failed');
    expect(failed.failureMessage).toBe('no claims');
  });
});
