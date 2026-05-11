import { eventIterator, oc } from '@orpc/contract';
import { z } from 'zod';
import { AnswerSegment } from '../shared/artifact.ts';
import { TurnId, WikiPageId } from '../shared/ids.ts';

export const AnswerStarted = z.object({
  kind: z.literal('AnswerStarted'),
  turnId: TurnId,
});

// Intermediate progress events let the UI render a live "agent thoughts" log
// without inferring phases from sparse segment-arrival timestamps. The
// dispatcher emits ResearchStarted before searching the pre-compiled wiki,
// one WikiPageRetrieved per page surfaced (so the user sees what the agent
// is reading, with title + pageType), ResearchCompleted when the search
// returns, then SynthesisStarted before the first AnswerSegment.
export const ResearchStarted = z.object({
  kind: z.literal('ResearchStarted'),
  turnId: TurnId,
  model: z.string().min(1),
});

export const WikiPageRetrieved = z.object({
  kind: z.literal('WikiPageRetrieved'),
  turnId: TurnId,
  wikiPageId: WikiPageId,
  title: z.string().min(1),
  pageType: z.string().optional(),
  citationCount: z.number().int().nonnegative(),
});

export const ResearchCompleted = z.object({
  kind: z.literal('ResearchCompleted'),
  turnId: TurnId,
  candidatePageCount: z.number().int().nonnegative(),
  findingCount: z.number().int().nonnegative(),
});

// Mid-stream progress fired as findings stream in. With the LLM Researcher
// dropped, this fires once after the D1 wiki search returns; the per-page
// detail lives in the WikiPageRetrieved events above.
export const ResearchProgress = z.object({
  kind: z.literal('ResearchProgress'),
  turnId: TurnId,
  findingsExtracted: z.number().int().nonnegative(),
});

export const SynthesisStarted = z.object({
  kind: z.literal('SynthesisStarted'),
  turnId: TurnId,
  model: z.string().min(1),
});

// Live train-of-thought from the Synthesizer: surfaces the partial JSON
// streaming inside an Artifact tool call (column names, row labels, …) so
// the user sees progress during the otherwise-silent ~15-25s the model
// spends generating tool inputs. Throttled adapter-side.
export const AnswerThinking = z.object({
  kind: z.literal('AnswerThinking'),
  turnId: TurnId,
  message: z.string().min(1),
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
  WikiPageRetrieved,
  ResearchProgress,
  ResearchCompleted,
  SynthesisStarted,
  AnswerThinking,
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
