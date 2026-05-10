import { type AnswerEvent, mockAnswerEventStream } from '@package/contracts/chat';
import type { AnswerSegment } from '@package/contracts/shared';
import { useLiveMode } from '../../lib/live-mode.tsx';
import { useAsyncIterableStream, useEventStream } from '../../lib/use-event-stream.ts';

export interface AnswerStreamState {
  segments: AnswerSegment[];
  finished: boolean;
  error: string | null;
}

export function useAnswerStream(turnId: string | null): AnswerStreamState {
  const { live } = useLiveMode();
  const liveResult = useEventStream<AnswerEvent>(
    live && turnId ? `/rpc/turns/${turnId}/answer/events` : null,
  );
  const mockResult = useAsyncIterableStream<AnswerEvent>(
    !live && turnId ? mockAnswerEventStream : null,
  );
  const { events, done, error } = live ? liveResult : mockResult;

  const segments: AnswerSegment[] = [];
  for (const e of events) {
    if (e.kind === 'AnswerSegment') segments[e.index] = e.segment;
  }
  const finished = events.some((e) => e.kind === 'AnswerFinished') || done;
  return { segments: segments.filter((s): s is AnswerSegment => s !== undefined), finished, error };
}
