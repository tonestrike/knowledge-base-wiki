import { useEffect, useState } from 'react';

export interface EventStreamState<T> {
  events: T[];
  done: boolean;
  error: string | null;
}

// Module-scoped identity parse so the default doesn't re-trigger useEffect
// on every render of the consumer hook.
const identityParse = <T>(raw: unknown): T => raw as T;

/**
 * Subscribes to a Server-Sent Events endpoint and returns the cumulative
 * list of parsed events.
 *
 * Why fetch + ReadableStream instead of EventSource: the contract's
 * `eventIterator()` output is JSON-per-event SSE; native EventSource would
 * give us strings only and hides errors. fetch lets us wire AbortController
 * for clean unmount and surface non-2xx as a typed error.
 */
export function useEventStream<T>(
  url: string | null,
  parse: (raw: unknown) => T = identityParse,
): EventStreamState<T> {
  const [events, setEvents] = useState<T[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    setEvents([]);
    setDone(false);
    setError(null);
    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetch(url, { signal: ac.signal });
        if (!res.ok || !res.body) throw new Error(`stream ${url} failed: ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { done: readerDone, value } = await reader.read();
          if (readerDone) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number = buf.indexOf('\n\n');
          while (idx !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const dataLine = frame
              .split('\n')
              .map((l) => (l.startsWith('data:') ? l.slice(5).trim() : null))
              .filter((l): l is string => l !== null)
              .join('\n');
            if (dataLine) {
              const parsed = parse(JSON.parse(dataLine));
              setEvents((prev) => [...prev, parsed]);
            }
            idx = buf.indexOf('\n\n');
          }
        }
        setDone(true);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError(String(e));
      }
    })();
    return () => ac.abort();
  }, [url, parse]);

  return { events, done, error };
}

/**
 * Drives state from any AsyncIterable source — used as a fallback when
 * the in-process mock factories (e.g. Bun-test, JSDOM environments
 * without MSW) need to feed event streams without a network round-trip.
 */
export function useAsyncIterableStream<T>(
  factory: (() => AsyncIterable<T>) | null,
  intervalMs = 600,
): EventStreamState<T> {
  const [events, setEvents] = useState<T[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!factory) return;
    setEvents([]);
    setDone(false);
    setError(null);
    let cancelled = false;
    (async () => {
      try {
        for await (const e of factory()) {
          if (cancelled) return;
          setEvents((prev) => [...prev, e]);
          await new Promise((r) => setTimeout(r, intervalMs));
        }
        if (!cancelled) setDone(true);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [factory, intervalMs]);

  return { events, done, error };
}
