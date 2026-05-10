import type { Conversation as ConvWire } from '@package/contracts/chat';
import type { ConversationId } from '@package/contracts/shared';
import type { ChatDeps } from './ports.ts';

export async function getConversation(
  deps: ChatDeps,
  input: { id: ConversationId },
): Promise<ConvWire> {
  const c = await deps.conversations.findById(input.id);
  if (!c) throw new Error(`Conversation not found: ${input.id}`);
  return deps.conversations.toWire(c);
}
