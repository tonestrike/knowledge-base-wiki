import type { Turn as TurnWire } from '@package/contracts/chat';
import type { ConversationId } from '@package/contracts/shared';
import type { ChatDeps } from './ports.ts';

export async function listTurns(
  deps: ChatDeps,
  input: { conversationId: ConversationId; cursor?: string; limit: number },
): Promise<{ items: TurnWire[]; nextCursor?: string }> {
  const page = await deps.turns.list({
    conversationId: input.conversationId,
    cursor: input.cursor,
    limit: input.limit,
  });
  return {
    items: page.items.map((t) => deps.turns.toWire(t)),
    ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}),
  };
}
