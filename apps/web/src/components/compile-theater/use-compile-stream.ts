import { type CompileEvent, mockCompileEventStream } from '@package/contracts/wiki';
import { useEffect, useState } from 'react';

export function useCompileStream() {
  const [events, setEvents] = useState<CompileEvent[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for await (const e of mockCompileEventStream()) {
        if (cancelled) break;
        setEvents((prev) => [...prev, e]);
        await new Promise((r) => setTimeout(r, 600));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return events;
}
