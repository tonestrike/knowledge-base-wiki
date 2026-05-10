import { describe, expect, it } from 'bun:test';
import { conversationId, userId, wikiId } from '@package/contracts/shared';
import { ask } from './ask.ts';
import { openConversation } from './open-conversation.ts';
import { makeFakeChatDeps } from './test-support.ts';

const cid = conversationId('55555555-2222-4333-8444-555555555555');
const uid = userId('99999999-2222-4333-8444-555555555555');
const wid = wikiId('44444444-2222-4333-8444-555555555555');

describe('openConversation', () => {
  it('creates a Conversation and returns its id', async () => {
    const d = makeFakeChatDeps({ ids: [cid] });
    const out = await openConversation({ ...d, currentUserId: uid }, { wikiId: wid });
    expect(out.conversationId).toBe(cid);
    const stored = await d.conversations.findById(cid);
    expect(stored?.wikiId).toBe(wid);
    expect(stored?.userId).toBe(uid);
  });
});

describe('ask', () => {
  const TID_RAW = '66666666-2222-4333-8444-555555555555';

  it('rejects when the conversation is missing', async () => {
    const d = makeFakeChatDeps();
    await expect(ask(d, { conversationId: cid, question: 'Q?' })).rejects.toThrow(/not found/i);
  });

  it('creates a Turn, dispatches it, and returns its id', async () => {
    const d = makeFakeChatDeps({ ids: [cid, TID_RAW] });
    await openConversation({ ...d, currentUserId: uid }, { wikiId: wid });
    const out = await ask(d, { conversationId: cid, question: 'Q?' });
    expect(out.turnId).toBe(TID_RAW as typeof out.turnId);
    expect(d._dispatched).toEqual([
      { conversationId: cid, turnId: out.turnId, wikiId: wid, question: 'Q?' },
    ]);
    const turn = await d.turns.findById(out.turnId);
    expect(turn?.question).toBe('Q?');
  });
});
