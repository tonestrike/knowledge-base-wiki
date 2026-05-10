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
      parse: (raw) =>
        LintEvent.parse(
          typeof raw === 'object' && raw !== null && 'json' in raw
            ? (raw as { json: unknown }).json
            : raw,
        ),
      failedKinds: FAILED,
      finishedKinds: FINISHED,
      method: 'POST',
      body: { json: { lintRunId } },
    }),
    [lintRunId],
  );
  const liveResult = useEventStream<LintEvent>(
    mode.kind === 'live' && lintRunId ? '/rpc/verification/streamLintEvents' : null,
    config,
  );
  const mockResult = useAsyncIterableStream<LintEvent>(
    mode.kind === 'static' && lintRunId ? mockLintEventStream : null,
  );
  return mode.kind === 'live' ? liveResult : mockResult;
}
