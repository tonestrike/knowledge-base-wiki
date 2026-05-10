import { describe, expect, it } from 'bun:test';
import { compileRunId, folderId, wikiId } from '@package/contracts/shared';
import { CompileRun } from './compile-run.ts';

describe('CompileRun status machine', () => {
  const id = compileRunId('33333333-2222-4333-8444-555555555555');
  const fid = folderId('22222222-2222-4333-8444-555555555555');
  const wid = wikiId('44444444-2222-4333-8444-555555555555');

  it('starts pending', () => {
    const r = CompileRun.start({ id, folderId: fid, startedAt: '2026-05-09T12:00:00.000Z' });
    expect(r.status).toBe('pending');
  });

  it('progresses pending → inferring-schema → planning → ... → finished', () => {
    let r: CompileRun = CompileRun.start({
      id,
      folderId: fid,
      startedAt: '2026-05-09T12:00:00.000Z',
    });
    r = CompileRun.advance(r, 'inferring-schema', '2026-05-09T12:00:01.000Z');
    r = CompileRun.advance(r, 'planning', '2026-05-09T12:00:05.000Z');
    if (r.status === 'planning') expect(r.schemaInferredAt).toBe('2026-05-09T12:00:05.000Z');
    r = CompileRun.advance(r, 'researching', '2026-05-09T12:00:10.000Z');
    r = CompileRun.advance(r, 'drafting', '2026-05-09T12:00:30.000Z');
    r = CompileRun.advance(r, 'linking', '2026-05-09T12:00:45.000Z');
    r = CompileRun.advance(r, 'indexing', '2026-05-09T12:00:50.000Z');
    r = CompileRun.finish(r, { wikiId: wid, endedAt: '2026-05-09T12:01:00.000Z' });
    expect(r.status).toBe('finished');
    if (r.status !== 'finished') throw new Error('unreachable');
    expect(r.endedAt).toBe('2026-05-09T12:01:00.000Z');
    expect(r.wikiId).toBe(wid);
  });

  it('rejects illegal transitions', () => {
    const r = CompileRun.start({ id, folderId: fid, startedAt: '2026-05-09T12:00:00.000Z' });
    expect(() => CompileRun.advance(r, 'drafting', '2026-05-09T12:00:01.000Z')).toThrow(/illegal/);
  });

  it('fail records the message and ends the run', () => {
    const r = CompileRun.start({ id, folderId: fid, startedAt: '2026-05-09T12:00:00.000Z' });
    const failed = CompileRun.fail(r, 'boom', '2026-05-09T12:00:02.000Z');
    expect(failed.status).toBe('failed');
    expect(failed.failureMessage).toBe('boom');
  });

  it('cannot transition out of a terminal state', () => {
    const r = CompileRun.start({ id, folderId: fid, startedAt: '2026-05-09T12:00:00.000Z' });
    const failed = CompileRun.fail(r, 'boom', '2026-05-09T12:00:02.000Z');
    expect(() =>
      CompileRun.advance(failed, 'inferring-schema', '2026-05-09T12:00:03.000Z'),
    ).toThrow(/terminal/);
  });
});
