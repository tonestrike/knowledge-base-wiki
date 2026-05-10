import { type LintEvent, mockLintEventStream } from '@package/contracts/verification';
import { useLiveMode } from '../../lib/live-mode.tsx';
import { useAsyncIterableStream, useEventStream } from '../../lib/use-event-stream.ts';

export function useLintStream(lintRunId: string | null): {
  events: LintEvent[];
  done: boolean;
  error: string | null;
} {
  const { live } = useLiveMode();
  const liveResult = useEventStream<LintEvent>(
    live && lintRunId ? `/rpc/lint-runs/${lintRunId}/events` : null,
  );
  const mockResult = useAsyncIterableStream<LintEvent>(
    !live && lintRunId ? mockLintEventStream : null,
  );
  return live ? liveResult : mockResult;
}
