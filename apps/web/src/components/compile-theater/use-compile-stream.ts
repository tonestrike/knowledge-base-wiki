import { CompileEvent, mockCompileEventStream } from '@package/contracts/wiki';
import { useMemo } from 'react';
import { useLiveMode } from '../../lib/live-mode.tsx';
import {
  type EventStreamConfig,
  useAsyncIterableStream,
  useEventStream,
} from '../../lib/use-event-stream.ts';

const FAILED: ReadonlyArray<string> = ['CompileFailed'];
const FINISHED: ReadonlyArray<string> = ['CompileFinished'];

export function useCompileStream(compileRunId: string | null): {
  events: CompileEvent[];
  done: boolean;
  error: string | null;
} {
  const { mode } = useLiveMode();
  const config = useMemo<EventStreamConfig<CompileEvent>>(
    () => ({
      parse: (raw) => CompileEvent.parse(raw),
      failedKinds: FAILED,
      finishedKinds: FINISHED,
    }),
    [],
  );
  const liveResult = useEventStream<CompileEvent>(
    mode.kind === 'live' && compileRunId ? `/rpc/compile-runs/${compileRunId}/events` : null,
    config,
  );
  const mockResult = useAsyncIterableStream<CompileEvent>(
    mode.kind === 'static' ? mockCompileEventStream : null,
  );
  return mode.kind === 'live' ? liveResult : mockResult;
}
