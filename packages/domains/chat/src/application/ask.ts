import { type ConversationId, type TurnId, turnId } from '@package/contracts/shared';
import { Turn } from '../domain/turn.ts';
import { ConversationNotFoundError } from './errors.ts';
import type { ChatDeps } from './ports.ts';

export async function ask(
  deps: ChatDeps,
  input: { conversationId: ConversationId; question: string },
): Promise<{ turnId: TurnId }> {
  const c = await deps.conversations.findById(input.conversationId);
  if (!c) throw new ConversationNotFoundError(input.conversationId);

  const id = turnId(deps.newId());
  const turn = Turn.start({
    id,
    conversationId: input.conversationId,
    question: input.question,
    createdAt: deps.now().toISOString(),
  });
  await deps.turns.insert(turn);
  await deps.dispatcher.start({
    conversationId: c.id,
    turnId: id,
    wikiId: c.wikiId,
    question: input.question,
    ...(deps.waitUntil ? { waitUntil: deps.waitUntil } : {}),
  });
  return { turnId: id };
}
