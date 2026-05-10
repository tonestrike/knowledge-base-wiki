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
  // SSE comes back as oRPC RPC frames whose payload is wrapped in `{ json: ... }`.
  // Unwrap before handing the raw event to Zod so the discriminated union parses.
  const config = useMemo<EventStreamConfig<CompileEvent>>(
    () => ({
      parse: (raw) =>
        CompileEvent.parse(
          typeof raw === 'object' && raw !== null && 'json' in raw
            ? (raw as { json: unknown }).json
            : raw,
        ),
      failedKinds: FAILED,
      finishedKinds: FINISHED,
      method: 'POST',
      body: { json: { compileRunId } },
    }),
    [compileRunId],
  );
  const liveResult = useEventStream<CompileEvent>(
    mode.kind === 'live' && compileRunId ? '/rpc/wiki/streamCompileEvents' : null,
    config,
  );
  const mockResult = useAsyncIterableStream<CompileEvent>(
    mode.kind === 'static' ? mockCompileEventStream : null,
  );
  return mode.kind === 'live' ? liveResult : mockResult;
}
