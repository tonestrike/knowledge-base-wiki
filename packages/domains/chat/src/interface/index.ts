import { ORPCError, implement } from '@orpc/server';
import { chatContract } from '@package/contracts/chat';
import type { UserId } from '@package/contracts/shared';
import type { Clock } from '@package/shared-kernel';
import { ask } from '../application/ask.ts';
import { ConversationNotFoundError, TurnNotFoundError } from '../application/errors.ts';
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

// SF-CHAT-8: typed not-found errors → ORPCError('NOT_FOUND'). The use-case
// keeps throwing the typed domain error; the interface boundary translates.
const mapNotFound = <T>(p: Promise<T>): Promise<T> =>
  p.catch((err: unknown) => {
    if (err instanceof ConversationNotFoundError || err instanceof TurnNotFoundError) {
      throw new ORPCError('NOT_FOUND', { message: err.message });
    }
    throw err;
  });

export const chatRouter = {
  open: os.open.handler(({ context, input }) =>
    openConversation({ ...context, currentUserId: context.currentUserId }, input),
  ),
  getConversation: os.getConversation.handler(({ context, input }) =>
    mapNotFound(getConversation(context, input)),
  ),
  listConversations: os.listConversations.handler(({ context, input }) =>
    listConversations(context, input),
  ),
  ask: os.ask.handler(({ context, input }) => mapNotFound(ask(context, input))),
  getTurn: os.getTurn.handler(({ context, input }) =>
    mapNotFound(getTurn(context, { id: input.id })),
  ),
  listTurns: os.listTurns.handler(({ context, input }) => listTurns(context, input)),
  // SF-CHAT-9: wrap subscribe in try/catch so a synchronous throw from the
  // dispatcher (e.g. tape lookup race) yields an AnswerFailed event to the
  // client instead of a connection drop with no diagnostic.
  streamAnswer: os.streamAnswer.handler(async function* ({ context, input }) {
    const turn = await context.turns.findById(input.turnId);
    if (!turn) {
      throw new ORPCError('NOT_FOUND', { message: `Turn ${input.turnId} not found` });
    }
    try {
      for await (const e of context.dispatcher.subscribe({
        conversationId: turn.conversationId,
        turnId: input.turnId,
      })) {
        yield e;
      }
    } catch (err) {
      console.error('[chat.interface.streamAnswer] dispatcher subscribe threw', {
        turnId: input.turnId,
        conversationId: turn.conversationId,
        err:
          err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
      });
      yield {
        kind: 'AnswerFailed',
        turnId: input.turnId,
        message: `Stream subscribe failed (turnId=${input.turnId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  }),
};
