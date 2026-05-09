import { oc } from '@orpc/contract';
import { z } from 'zod';
import { ConversationId, UserId, WikiId } from '../shared/ids.ts';

export const Conversation = z.object({
  id: ConversationId,
  wikiId: WikiId,
  userId: UserId,
  title: z.string().min(1).max(120).optional(),
  createdAt: z.string().datetime(),
});
export type Conversation = z.infer<typeof Conversation>;

export const OpenConversationInput = z.object({ wikiId: WikiId });
export const OpenConversationOutput = z.object({ conversationId: ConversationId });

export const GetConversationInput = z.object({ id: ConversationId });
export const ListConversationsInput = z.object({
  wikiId: WikiId.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(50).default(20),
});
export const ListConversationsOutput = z.object({
  items: z.array(Conversation),
  nextCursor: z.string().optional(),
});

export const conversationsContract = {
  open: oc
    .route({ method: 'POST', path: '/conversations' })
    .input(OpenConversationInput)
    .output(OpenConversationOutput),
  getConversation: oc
    .route({ method: 'GET', path: '/conversations/{id}' })
    .input(GetConversationInput)
    .output(Conversation),
  listConversations: oc
    .route({ method: 'GET', path: '/conversations' })
    .input(ListConversationsInput)
    .output(ListConversationsOutput),
};
