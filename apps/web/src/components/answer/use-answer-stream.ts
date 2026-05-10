import { AnswerEvent, mockAnswerEventStream } from '@package/contracts/chat';
import type { AnswerSegment } from '@package/contracts/shared';
import { useMemo } from 'react';
import { useLiveMode } from '../../lib/live-mode.tsx';
import {
  type EventStreamConfig,
  useAsyncIterableStream,
  useEventStream,
} from '../../lib/use-event-stream.ts';

export interface AnswerStreamState {
  segments: AnswerSegment[];
  finished: boolean;
  error: string | null;
}

const FAILED: ReadonlyArray<string> = ['AnswerFailed'];
const FINISHED: ReadonlyArray<string> = ['AnswerFinished'];

export function useAnswerStream(turnId: string | null): AnswerStreamState {
  const { mode } = useLiveMode();
  // Memoize to keep config-identity stable across renders (the hook deps
  // are [url, config], so a fresh object would re-fire the effect every
  // render and abort the in-flight stream).
  const config = useMemo<EventStreamConfig<AnswerEvent>>(
    () => ({
      parse: (raw) => AnswerEvent.parse(raw),
      failedKinds: FAILED,
      finishedKinds: FINISHED,
    }),
    [],
  );
  const liveResult = useEventStream<AnswerEvent>(
    mode.kind === 'live' && turnId ? `/rpc/turns/${turnId}/answer/events` : null,
    config,
  );
  const mockResult = useAsyncIterableStream<AnswerEvent>(
    mode.kind === 'static' && turnId ? mockAnswerEventStream : null,
  );
  const { events, done, error } = mode.kind === 'live' ? liveResult : mockResult;

  const segments: AnswerSegment[] = [];
  for (const e of events) {
    if (e.kind === 'AnswerSegment') segments[e.index] = e.segment;
  }
  const finished = events.some((e) => e.kind === 'AnswerFinished') || done;
  return { segments: segments.filter((s): s is AnswerSegment => s !== undefined), finished, error };
}
