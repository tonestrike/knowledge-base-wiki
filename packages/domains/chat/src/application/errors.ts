import type { ConversationId, TurnId } from '@package/contracts/shared';

/**
 * Typed not-found errors for the chat aggregates. The interface layer maps
 * these to `ORPCError('NOT_FOUND', ...)` (SF-CHAT-8) so callers see a typed
 * 404 instead of an opaque 500.
 */
export class ConversationNotFoundError extends Error {
  readonly conversationId: ConversationId;
  constructor(id: ConversationId) {
    super(`Conversation not found: ${id}`);
    this.name = 'ConversationNotFoundError';
    this.conversationId = id;
  }
}

export class TurnNotFoundError extends Error {
  readonly turnId: TurnId;
  constructor(id: TurnId) {
    super(`Turn not found: ${id}`);
    this.name = 'TurnNotFoundError';
    this.turnId = id;
  }
}
