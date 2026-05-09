import { ORPCError, implement } from '@orpc/server';
import { chatContract } from '@package/contracts/chat';
import type { Clock } from '@package/shared-kernel';

export interface ChatContext {
  clock: Clock;
}

const os = implement(chatContract).$context<ChatContext>();

const todo = (procedure: string): never => {
  throw new ORPCError('NOT_IMPLEMENTED', {
    message: `chat.${procedure} is scaffolded but not implemented (Slice 2.C)`,
  });
};

export const chatRouter = {
  open: os.open.handler(() => todo('open')),
  getConversation: os.getConversation.handler(() => todo('getConversation')),
  listConversations: os.listConversations.handler(() => todo('listConversations')),
  ask: os.ask.handler(() => todo('ask')),
  getTurn: os.getTurn.handler(() => todo('getTurn')),
  listTurns: os.listTurns.handler(() => todo('listTurns')),
  // biome-ignore lint/correctness/useYield: stub generator throws before yielding (Slice 2.C wires the real stream)
  streamAnswer: os.streamAnswer.handler(async function* () {
    todo('streamAnswer');
  }),
};
