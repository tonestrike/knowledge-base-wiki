import type { Conversation as ConvWire } from '@package/contracts/chat';
import type { WikiId } from '@package/contracts/shared';
import type { ChatDeps } from './ports.ts';

export async function listConversations(
  deps: ChatDeps,
  input: { wikiId?: WikiId; cursor?: string; limit: number },
): Promise<{ items: ConvWire[]; nextCursor?: string }> {
  const page = await deps.conversations.list({
    wikiId: input.wikiId,
    cursor: input.cursor,
    limit: input.limit,
  });
  return {
    items: page.items.map((c) => deps.conversations.toWire(c)),
    ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}),
  };
}
