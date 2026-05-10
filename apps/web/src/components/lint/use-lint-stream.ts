import { LintEvent, mockLintEventStream } from '@package/contracts/verification';
import { useMemo } from 'react';
import { useLiveMode } from '../../lib/live-mode.tsx';
import {
  type EventStreamConfig,
  useAsyncIterableStream,
  useEventStream,
} from '../../lib/use-event-stream.ts';

const FAILED: ReadonlyArray<string> = ['LintRunFailed'];
const FINISHED: ReadonlyArray<string> = ['LintRunFinished'];

export function useLintStream(lintRunId: string | null): {
  events: LintEvent[];
  done: boolean;
  error: string | null;
} {
  const { mode } = useLiveMode();
  const config = useMemo<EventStreamConfig<LintEvent>>(
    () => ({
      parse: (raw) => LintEvent.parse(raw),
      failedKinds: FAILED,
      finishedKinds: FINISHED,
    }),
    [],
  );
  const liveResult = useEventStream<LintEvent>(
    mode.kind === 'live' && lintRunId ? `/rpc/lint-runs/${lintRunId}/events` : null,
    config,
  );
  const mockResult = useAsyncIterableStream<LintEvent>(
    mode.kind === 'static' && lintRunId ? mockLintEventStream : null,
  );
  return mode.kind === 'live' ? liveResult : mockResult;
}
