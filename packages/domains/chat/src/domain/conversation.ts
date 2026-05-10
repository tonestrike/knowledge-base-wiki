import type { ConversationId, UserId, WikiId } from '@package/contracts/shared';

export interface Conversation {
  readonly id: ConversationId;
  readonly wikiId: WikiId;
  readonly userId: UserId;
  readonly title?: string;
  readonly createdAt: string;
}

export const Conversation = {
  open(props: {
    id: ConversationId;
    wikiId: WikiId;
    userId: UserId;
    createdAt: string;
  }): Conversation {
    return Object.freeze({ ...props });
  },
  withTitle(c: Conversation, title: string): Conversation {
    if (title.length === 0 || title.length > 120) {
      throw new Error('title must be 1..120 chars');
    }
    return Object.freeze({ ...c, title });
  },
};
