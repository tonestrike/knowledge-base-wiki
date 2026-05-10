import { type CompileEvent, mockCompileEventStream } from '@package/contracts/wiki';
import { useLiveMode } from '../../lib/live-mode.tsx';
import { useAsyncIterableStream, useEventStream } from '../../lib/use-event-stream.ts';

export function useCompileStream(compileRunId: string | null): {
  events: CompileEvent[];
  done: boolean;
  error: string | null;
} {
  const { live } = useLiveMode();
  const liveResult = useEventStream<CompileEvent>(
    live && compileRunId ? `/rpc/compile-runs/${compileRunId}/events` : null,
  );
  const mockResult = useAsyncIterableStream<CompileEvent>(!live ? mockCompileEventStream : null);
  return live ? liveResult : mockResult;
}
