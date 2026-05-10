import type { AnswerSegment, ConversationId, TurnId } from '@package/contracts/shared';

export interface Turn {
  readonly id: TurnId;
  readonly conversationId: ConversationId;
  readonly question: string;
  readonly answer: ReadonlyArray<AnswerSegment>;
  readonly createdAt: string;
  readonly finishedAt?: string;
}

export const Turn = {
  start(props: {
    id: TurnId;
    conversationId: ConversationId;
    question: string;
    createdAt: string;
  }): Turn {
    if (!props.question.trim()) throw new Error('question is empty');
    return Object.freeze({ ...props, answer: Object.freeze([]) as ReadonlyArray<AnswerSegment> });
  },
  appendSegment(t: Turn, seg: AnswerSegment): Turn {
    if (t.finishedAt) throw new Error('cannot append to a finished Turn');
    return Object.freeze({
      ...t,
      answer: Object.freeze([...t.answer, seg]) as ReadonlyArray<AnswerSegment>,
    });
  },
  finish(t: Turn, at: string): Turn {
    if (t.finishedAt) return t;
    return Object.freeze({ ...t, finishedAt: at });
  },
};
