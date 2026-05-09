import { eventIterator, oc } from '@orpc/contract';
import { z } from 'zod';
import { AnswerSegment } from '../shared/artifact.ts';
import { TurnId } from '../shared/ids.ts';

export const AnswerStarted = z.object({
  kind: z.literal('AnswerStarted'),
  turnId: TurnId,
});

export const AnswerSegmentEmitted = z.object({
  kind: z.literal('AnswerSegment'),
  turnId: TurnId,
  index: z.number().int().nonnegative(),
  segment: AnswerSegment,
});

export const AnswerProseDelta = z.object({
  kind: z.literal('AnswerProseDelta'),
  turnId: TurnId,
  segmentIndex: z.number().int().nonnegative(),
  textDelta: z.string(),
});

export const AnswerFailed = z.object({
  kind: z.literal('AnswerFailed'),
  turnId: TurnId,
  message: z.string(),
});

export const AnswerFinished = z.object({
  kind: z.literal('AnswerFinished'),
  turnId: TurnId,
});

export const AnswerEvent = z.discriminatedUnion('kind', [
  AnswerStarted,
  AnswerSegmentEmitted,
  AnswerProseDelta,
  AnswerFailed,
  AnswerFinished,
]);
export type AnswerEvent = z.infer<typeof AnswerEvent>;

export const StreamAnswerInput = z.object({ turnId: TurnId });

export const answersContract = {
  streamAnswer: oc
    .route({ method: 'GET', path: '/turns/{turnId}/answer/events' })
    .input(StreamAnswerInput)
    .output(eventIterator(AnswerEvent)),
};
