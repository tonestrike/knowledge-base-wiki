import { describe, expect, it } from 'bun:test';
import { conversationId, userId, wikiId } from '@package/contracts/shared';
import { Conversation } from './conversation.ts';

describe('Conversation', () => {
  const props = {
    id: conversationId('55555555-2222-4333-8444-555555555555'),
    wikiId: wikiId('44444444-2222-4333-8444-555555555555'),
    userId: userId('99999999-2222-4333-8444-555555555555'),
    createdAt: '2026-05-09T12:00:00.000Z',
  };

  it('opens with id, wikiId, userId, createdAt and no title', () => {
    const c = Conversation.open(props);
    expect(c.id).toBe(props.id);
    expect(c.wikiId).toBe(props.wikiId);
    expect(c.title).toBeUndefined();
  });

  it('withTitle sets the title immutably', () => {
    const c = Conversation.open(props);
    const c2 = Conversation.withTitle(c, 'Q3 NRR review');
    expect(c2.title).toBe('Q3 NRR review');
    expect(c.title).toBeUndefined();
  });

  it('withTitle rejects empty or oversize titles', () => {
    const c = Conversation.open(props);
    expect(() => Conversation.withTitle(c, '')).toThrow(/1..120/);
    expect(() => Conversation.withTitle(c, 'x'.repeat(121))).toThrow(/1..120/);
  });
});
