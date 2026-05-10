import { eventIterator, oc } from '@orpc/contract';
import { z } from 'zod';
import { AnswerSegment } from '../shared/artifact.ts';
import { TurnId } from '../shared/ids.ts';

export const AnswerStarted = z.object({
  kind: z.literal('AnswerStarted'),
  turnId: TurnId,
});

// Intermediate progress events let the UI render a live "agent thoughts" log
// without inferring phases from sparse segment-arrival timestamps. The chat
// dispatcher emits one ResearchStarted before the Researcher prompt fires,
// one ResearchCompleted when the Researcher returns (carrying candidate +
// finding counts so the user sees what was actually grounded), and one
// SynthesisStarted before the first AnswerSegment.
export const ResearchStarted = z.object({
  kind: z.literal('ResearchStarted'),
  turnId: TurnId,
  model: z.string().min(1),
});

export const ResearchCompleted = z.object({
  kind: z.literal('ResearchCompleted'),
  turnId: TurnId,
  candidatePageCount: z.number().int().nonnegative(),
  findingCount: z.number().int().nonnegative(),
});

export const SynthesisStarted = z.object({
  kind: z.literal('SynthesisStarted'),
  turnId: TurnId,
  model: z.string().min(1),
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
  ResearchStarted,
  ResearchCompleted,
  SynthesisStarted,
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
