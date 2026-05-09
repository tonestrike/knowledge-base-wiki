import { oc } from '@orpc/contract';
import { z } from 'zod';
import { AnswerSegment } from '../shared/artifact.ts';
import { ConversationId, TurnId } from '../shared/ids.ts';

export const Turn = z.object({
  id: TurnId,
  conversationId: ConversationId,
  question: z.string().min(1).max(2000),
  answer: z.array(AnswerSegment),
  createdAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional(),
});
export type Turn = z.infer<typeof Turn>;

export const AskInput = z.object({
  conversationId: ConversationId,
  question: z.string().min(1).max(2000),
});
export const AskOutput = z.object({ turnId: TurnId });

export const GetTurnInput = z.object({ id: TurnId });
export const ListTurnsInput = z.object({
  conversationId: ConversationId,
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export const ListTurnsOutput = z.object({
  items: z.array(Turn),
  nextCursor: z.string().optional(),
});

export const turnsContract = {
  ask: oc.route({ method: 'POST', path: '/turns' }).input(AskInput).output(AskOutput),
  getTurn: oc.route({ method: 'GET', path: '/turns/{id}' }).input(GetTurnInput).output(Turn),
  listTurns: oc
    .route({ method: 'GET', path: '/turns' })
    .input(ListTurnsInput)
    .output(ListTurnsOutput),
};
