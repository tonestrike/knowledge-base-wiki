import { useEffect, useState } from 'react';

/**
 * Public state shape every consumer hook (useAnswerStream / useLintStream /
 * useCompileStream) returns. The flat `events`/`done`/`error` triple is a
 * minimum contract; consumers MUST inspect `error` and treat a non-null
 * value as a stream-level failure (mid-stream `*Failed` event, premature
 * close after retries, network/HTTP failure).
 */
export interface EventStreamState<T> {
  events: T[];
  done: boolean;
  error: string | null;
}

/**
 * Optional config a wrapper passes to declare which event `kind` strings
 * count as terminal — `failedKinds` flips the stream into the error state
 * with the event's `message` field; `finishedKinds` marks `done` true. When
 * the underlying reader closes WITHOUT having seen a terminal event we
 * treat that as a premature close (network drop, server crash mid-stream)
 * and surface a connection error per SF4.
 */
export interface EventStreamConfig<T> {
  parse: (raw: unknown) => T;
  /** Event kinds that terminate the stream as a failure. */
  failedKinds?: ReadonlyArray<string>;
  /** Event kinds that terminate the stream as a success. */
  finishedKinds?: ReadonlyArray<string>;
  /**
   * Reconnect attempts on premature close. Default 3. Each attempt waits
   * `2^attempt * 1000` ms (1s, 2s, 4s) before retrying. After the budget
   * is exhausted we surface a permanent connection-lost error.
   */
  maxReconnects?: number;
  /**
   * HTTP method. oRPC's RPC handler exposes streaming procedures over POST
   * with a JSON body, so consumers of `streamCompileEvents` /
   * `streamLintEvents` / `streamAnswer` pass `'POST'` here. Defaults to GET
   * for backwards compat with raw SSE endpoints.
   */
  method?: 'GET' | 'POST';
  /**
   * Optional JSON body, sent only when `method === 'POST'`. The oRPC RPC
   * handler expects the input wrapped under a top-level `json` key —
   * callers MUST shape it that way themselves so this hook stays
   * transport-agnostic.
   */
  body?: unknown;
}

const DEFAULT_MAX_RECONNECTS = 3;
const RECONNECT_BASE_MS = 1000;

interface KindCarrier {
  kind?: unknown;
  message?: unknown;
  reason?: unknown;
}

const eventKind = (e: unknown): string | null => {
  if (typeof e !== 'object' || e === null) return null;
  const k = (e as KindCarrier).kind;
  return typeof k === 'string' ? k : null;
};

const eventMessage = (e: unknown): string => {
  if (typeof e !== 'object' || e === null) return 'stream failed';
  const m = (e as KindCarrier).message ?? (e as KindCarrier).reason;
  return typeof m === 'string' && m.length > 0 ? m : 'stream failed';
};

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'));
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

interface SseFrame {
  /** SSE `event:` field; empty string when absent. */
  event: string;
  /** Joined `data:` payload. */
  data: string;
}

const parseFrame = (raw: string): SseFrame => {
  let event = '';
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    // ignore comments (`:`) and `id:` / `retry:` for now — eventIterator
    // only emits `event:` + `data:`.
  }
  return { event, data: dataLines.join('\n') };
};

/**
 * Subscribes to a Server-Sent Events endpoint and returns the cumulative
 * list of parsed events.
 *
 * Why fetch + ReadableStream instead of EventSource: the contract's
 * `eventIterator()` output is JSON-per-event SSE; native EventSource would
 * give us strings only and hides errors. fetch lets us wire AbortController
 * for clean unmount, parse `event:` lines (SF1), and surface non-2xx as a
 * typed error.
 *
 * Failure semantics (per SF1, SF4):
 *   1. Mid-stream `event: error` frame OR a `*Failed` event-kind known to
 *      the wrapper (`failedKinds`) → set `error`, stop.
 *   2. Reader close before any terminal event → exponential-backoff
 *      reconnect up to `maxReconnects`. If still no terminal event, set
 *      `error = 'connection lost'`.
 *   3. Frame fails Zod parsing → `console.warn` + skip frame; the stream
 *      keeps reading rather than poisoning the whole UI.
 */
export function useEventStream<T>(
  url: string | null,
  config: EventStreamConfig<T>,
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
    const maxReconnects = config.maxReconnects ?? DEFAULT_MAX_RECONNECTS;
    const failedKinds = config.failedKinds ?? [];
    const finishedKinds = config.finishedKinds ?? [];
    let terminalSeen = false;

    const runOnce = async (): Promise<'terminal' | 'premature' | 'http-error'> => {
      const init: RequestInit = { signal: ac.signal };
      if (config.method === 'POST') {
        init.method = 'POST';
        init.headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
        init.body = JSON.stringify(config.body ?? {});
      }
      const res = await fetch(url, init);
      if (!res.ok || !res.body) {
        setError(`stream ${url} failed: ${res.status}`);
        return 'http-error';
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done: readerDone, value } = await reader.read();
        if (readerDone) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number = buf.indexOf('\n\n');
        while (idx !== -1) {
          const frame = parseFrame(buf.slice(0, idx));
          buf = buf.slice(idx + 2);
          // Server can send `event: error` for transport-level failures
          // that don't fit the discriminated event union.
          if (frame.event === 'error') {
            terminalSeen = true;
            const msg = frame.data || 'stream failed';
            setError(msg);
            return 'terminal';
          }
          if (frame.data) {
            let raw: unknown;
            try {
              raw = JSON.parse(frame.data);
            } catch (e) {
              console.warn(`useEventStream: malformed JSON frame in ${url}`, e, frame.data);
              idx = buf.indexOf('\n\n');
              continue;
            }
            let parsed: T;
            try {
              parsed = config.parse(raw);
            } catch (e) {
              console.warn(`useEventStream: parse rejected frame in ${url}`, e, raw);
              idx = buf.indexOf('\n\n');
              continue;
            }
            const kind = eventKind(raw);
            if (kind && failedKinds.includes(kind)) {
              terminalSeen = true;
              setEvents((prev) => [...prev, parsed]);
              setError(eventMessage(raw));
              return 'terminal';
            }
            setEvents((prev) => [...prev, parsed]);
            if (kind && finishedKinds.includes(kind)) {
              terminalSeen = true;
              setDone(true);
              return 'terminal';
            }
          }
          idx = buf.indexOf('\n\n');
        }
      }
      return terminalSeen ? 'terminal' : 'premature';
    };

    (async () => {
      try {
        let attempt = 0;
        // Loop with backoff on premature close. Stop on terminal/http-error
        // or when the budget is exhausted.
        while (true) {
          const outcome = await runOnce();
          if (outcome === 'terminal' || outcome === 'http-error') return;
          // outcome === 'premature'
          if (attempt >= maxReconnects) {
            // No `failedKinds`/`finishedKinds` configured (or none seen) ⇒
            // wrapper opts into "EOF == done" semantics. Only surface a
            // connection-lost error when the wrapper declared terminal
            // kinds, because that's the only signal that a premature close
            // is actually wrong.
            if (failedKinds.length > 0 || finishedKinds.length > 0) {
              setError('connection lost');
            } else {
              setDone(true);
            }
            return;
          }
          await sleep(RECONNECT_BASE_MS * 2 ** attempt, ac.signal);
          attempt += 1;
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError(String(e));
      }
    })();
    return () => ac.abort();
  }, [url, config]);

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
