import { describe, expect, it } from 'bun:test';
import { conversationId, turnId } from '@package/contracts/shared';
import { Turn } from './turn.ts';

describe('Turn', () => {
  const cid = conversationId('55555555-2222-4333-8444-555555555555');
  const tid = turnId('66666666-2222-4333-8444-555555555555');

  it('starts with an empty answer and finishedAt undefined', () => {
    const t = Turn.start({
      id: tid,
      conversationId: cid,
      question: 'Q?',
      createdAt: '2026-05-09T12:00:00.000Z',
    });
    expect(t.answer).toEqual([]);
    expect(t.finishedAt).toBeUndefined();
  });

  it('rejects an empty question', () => {
    expect(() =>
      Turn.start({
        id: tid,
        conversationId: cid,
        question: '   ',
        createdAt: '2026-05-09T12:00:00.000Z',
      }),
    ).toThrow(/empty/);
  });

  it('appends segments in order and locks at finish', () => {
    let t = Turn.start({
      id: tid,
      conversationId: cid,
      question: 'Q?',
      createdAt: '2026-05-09T12:00:00.000Z',
    });
    t = Turn.appendSegment(t, { kind: 'prose', text: 'a' });
    t = Turn.appendSegment(t, { kind: 'prose', text: 'b' });
    t = Turn.finish(t, '2026-05-09T12:00:01.000Z');
    expect(t.answer).toHaveLength(2);
    expect(t.finishedAt).toBe('2026-05-09T12:00:01.000Z');
    expect(() => Turn.appendSegment(t, { kind: 'prose', text: 'c' })).toThrow(/finished/);
  });

  it('finish is idempotent', () => {
    let t = Turn.start({
      id: tid,
      conversationId: cid,
      question: 'Q?',
      createdAt: '2026-05-09T12:00:00.000Z',
    });
    t = Turn.finish(t, '2026-05-09T12:00:01.000Z');
    const t2 = Turn.finish(t, '2026-05-09T12:00:02.000Z');
    expect(t2.finishedAt).toBe('2026-05-09T12:00:01.000Z');
  });
});
