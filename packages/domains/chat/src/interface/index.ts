import { ORPCError, implement } from '@orpc/server';
import { chatContract } from '@package/contracts/chat';
import type { UserId } from '@package/contracts/shared';
import type { Clock } from '@package/shared-kernel';
import { ask } from '../application/ask.ts';
import { getConversation } from '../application/get-conversation.ts';
import { getTurn } from '../application/get-turn.ts';
import { listConversations } from '../application/list-conversations.ts';
import { listTurns } from '../application/list-turns.ts';
import { openConversation } from '../application/open-conversation.ts';
import type { ChatDeps } from '../application/ports.ts';

export interface ChatContext extends ChatDeps {
  clock: Clock;
  currentUserId: UserId;
}

const os = implement(chatContract).$context<ChatContext>();

export const chatRouter = {
  open: os.open.handler(({ context, input }) =>
    openConversation({ ...context, currentUserId: context.currentUserId }, input),
  ),
  getConversation: os.getConversation.handler(({ context, input }) =>
    getConversation(context, input),
  ),
  listConversations: os.listConversations.handler(({ context, input }) =>
    listConversations(context, input),
  ),
  ask: os.ask.handler(({ context, input }) => ask(context, input)),
  getTurn: os.getTurn.handler(({ context, input }) => getTurn(context, { id: input.id })),
  listTurns: os.listTurns.handler(({ context, input }) => listTurns(context, input)),
  streamAnswer: os.streamAnswer.handler(async function* ({ context, input }) {
    const turn = await context.turns.findById(input.turnId);
    if (!turn) {
      throw new ORPCError('NOT_FOUND', { message: `Turn ${input.turnId} not found` });
    }
    for await (const e of context.dispatcher.subscribe({
      conversationId: turn.conversationId,
      turnId: input.turnId,
    })) {
      yield e;
    }
  }),
};
