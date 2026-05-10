import { AnswerEvent, mockAnswerEventStream } from '@package/contracts/chat';
import type { AnswerSegment } from '@package/contracts/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveMode } from '../../lib/live-mode.tsx';
import {
  type EventStreamConfig,
  useAsyncIterableStream,
  useEventStream,
} from '../../lib/use-event-stream.ts';

export interface TimedAnswerEvent {
  event: AnswerEvent;
  /** Wall-clock time the frame was first observed on the client. */
  arrivedAt: number;
}

export interface AnswerStreamState {
  segments: AnswerSegment[];
  /** Raw events with arrival timestamps so the UI can render a live log. */
  events: ReadonlyArray<TimedAnswerEvent>;
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
      parse: (raw) =>
        AnswerEvent.parse(
          typeof raw === 'object' && raw !== null && 'json' in raw
            ? (raw as { json: unknown }).json
            : raw,
        ),
      failedKinds: FAILED,
      finishedKinds: FINISHED,
      method: 'POST',
      body: { json: { turnId } },
    }),
    [turnId],
  );
  const liveResult = useEventStream<AnswerEvent>(
    mode.kind === 'live' && turnId ? '/rpc/chat/streamAnswer' : null,
    config,
  );
  const mockResult = useAsyncIterableStream<AnswerEvent>(
    mode.kind === 'static' && turnId ? mockAnswerEventStream : null,
  );
  const { events, done, error } = mode.kind === 'live' ? liveResult : mockResult;

  // Tag each event with the client wall-clock time the index was first seen.
  // Without this, the agent log would render every entry's "+Xs" label as the
  // current render time, collapsing them onto the same timestamp.
  const arrivalsRef = useRef<number[]>([]);
  const [_, bump] = useState(0);
  useEffect(() => {
    if (events.length > arrivalsRef.current.length) {
      const now = Date.now();
      for (let i = arrivalsRef.current.length; i < events.length; i++) {
        arrivalsRef.current.push(now);
      }
      bump((n) => n + 1);
    } else if (events.length === 0 && arrivalsRef.current.length > 0) {
      arrivalsRef.current = [];
    }
  }, [events.length]);

  const timed: TimedAnswerEvent[] = events.map((event, i) => ({
    event,
    arrivedAt: arrivalsRef.current[i] ?? Date.now(),
  }));

  const segments: AnswerSegment[] = [];
  for (const e of events) {
    if (e.kind === 'AnswerSegment') segments[e.index] = e.segment;
  }
  const finished = events.some((e) => e.kind === 'AnswerFinished') || done;
  return {
    segments: segments.filter((s): s is AnswerSegment => s !== undefined),
    events: timed,
    finished,
    error,
  };
}
