import { describe, expect, it } from 'bun:test';
import { conversationId, turnId, userId, wikiId } from '@package/contracts/shared';
import { ask } from './ask.ts';
import { getConversation } from './get-conversation.ts';
import { getTurn } from './get-turn.ts';
import { listConversations } from './list-conversations.ts';
import { listTurns } from './list-turns.ts';
import { openConversation } from './open-conversation.ts';
import { makeFakeChatDeps } from './test-support.ts';

const cid = conversationId('55555555-2222-4333-8444-555555555555');
const tid = turnId('66666666-2222-4333-8444-555555555555');
const uid = userId('99999999-2222-4333-8444-555555555555');
const wid = wikiId('44444444-2222-4333-8444-555555555555');

describe('chat read-side use-cases', () => {
  it('getConversation returns wire shape', async () => {
    const d = makeFakeChatDeps({ ids: [cid] });
    await openConversation({ ...d, currentUserId: uid }, { wikiId: wid });
    const wire = await getConversation(d, { id: cid });
    expect(wire).toEqual({
      id: cid,
      wikiId: wid,
      userId: uid,
      createdAt: '2026-05-09T12:00:00.000Z',
    });
  });

  it('getConversation throws on missing', async () => {
    const d = makeFakeChatDeps();
    await expect(getConversation(d, { id: cid })).rejects.toThrow(/not found/i);
  });

  it('listConversations returns items in wire shape', async () => {
    const d = makeFakeChatDeps({ ids: [cid] });
    await openConversation({ ...d, currentUserId: uid }, { wikiId: wid });
    const out = await listConversations(d, { limit: 20 });
    expect(out.items).toHaveLength(1);
    expect(out.items[0]?.id).toBe(cid);
  });

  it('getTurn returns wire shape and throws on missing', async () => {
    const d = makeFakeChatDeps({ ids: [cid, tid] });
    await openConversation({ ...d, currentUserId: uid }, { wikiId: wid });
    await ask(d, { conversationId: cid, question: 'Q?' });
    const wire = await getTurn(d, { id: tid });
    expect(wire.question).toBe('Q?');
    expect(wire.conversationId).toBe(cid);
    await expect(
      getTurn(d, { id: turnId('00000000-0000-4000-8000-000000000000') }),
    ).rejects.toThrow(/not found/i);
  });

  it('listTurns proxies to the repo with conversationId', async () => {
    const d = makeFakeChatDeps({ ids: [cid, tid] });
    await openConversation({ ...d, currentUserId: uid }, { wikiId: wid });
    await ask(d, { conversationId: cid, question: 'Q?' });
    const out = await listTurns(d, { conversationId: cid, limit: 50 });
    expect(out.items).toHaveLength(1);
    expect(out.items[0]?.id).toBe(tid);
  });
});
