import {
  type ConversationId,
  type UserId,
  type WikiId,
  conversationId,
} from '@package/contracts/shared';
import { Conversation } from '../domain/conversation.ts';
import type { ChatDeps } from './ports.ts';

export interface OpenConversationDeps extends ChatDeps {
  currentUserId: UserId;
}

export async function openConversation(
  deps: OpenConversationDeps,
  input: { wikiId: WikiId },
): Promise<{ conversationId: ConversationId }> {
  const id = conversationId(deps.newId());
  const c = Conversation.open({
    id,
    wikiId: input.wikiId,
    userId: deps.currentUserId,
    createdAt: deps.now().toISOString(),
  });
  await deps.conversations.insert(c);
  return { conversationId: id };
}
