import { describe, expect, it } from 'bun:test';
import { chatContract } from './index.ts';
import { mockAnswerEventStream, mockConversation, mockTurn } from './mocks.ts';

describe('chat contract', () => {
  it('exposes conversations + turns + answer stream', () => {
    expect(Object.keys(chatContract).sort()).toEqual([
      'ask',
      'getConversation',
      'getTurn',
      'listConversations',
      'listTurns',
      'open',
      'streamAnswer',
    ]);
  });
});

describe('chat mocks', () => {
  it('mockAnswerEventStream emits prose, citation, artifact, and AnswerFinished', async () => {
    const kinds: string[] = [];
    const segmentKinds: string[] = [];
    for await (const e of mockAnswerEventStream()) {
      kinds.push(e.kind);
      if (e.kind === 'AnswerSegment') segmentKinds.push(e.segment.kind);
    }
    expect(kinds[0]).toBe('AnswerStarted');
    expect(kinds[kinds.length - 1]).toBe('AnswerFinished');
    expect(segmentKinds).toContain('prose');
    expect(segmentKinds).toContain('artifact');
    expect(segmentKinds).toContain('citation');
  });

  it('mockTurn returns a parseable Turn with at least one Artifact segment', () => {
    const t = mockTurn();
    expect(t.answer.some((s) => s.kind === 'artifact')).toBe(true);
  });

  it('mockConversation returns a parseable Conversation', () => {
    expect(() => mockConversation()).not.toThrow();
  });
});
