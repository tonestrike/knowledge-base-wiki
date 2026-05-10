import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * Discriminated mode (TD2). The 'live' branch subscribes to real SSE
 * endpoints; the 'static' branch consumes in-process mock AsyncIterables
 * (used by the design-system gallery so visual snapshots render the final
 * state deterministically without waiting on timers).
 *
 * The 'unavailable' branch (SF5) lets a backend procedure that returned
 * 501 NOT_IMPLEMENTED tell the UI to either fall back to mock fixtures or
 * surface a "backend not ready" notice, instead of silently rendering an
 * empty stream.
 */
export type LiveMode =
  | { kind: 'live' }
  | { kind: 'static' }
  | { kind: 'unavailable'; reason: string };

interface LiveModeCtx {
  mode: LiveMode;
  setMode: (m: LiveMode) => void;
  /**
   * Convenience action: route handlers call this when they detect a
   * `NOT_IMPLEMENTED` / 501 error so the user sees a "backend not ready"
   * banner with a "fall back to mocks" toggle. Idempotent: if mode is
   * already `unavailable` with the same reason, this is a no-op.
   */
  markUnavailable: (reason: string) => void;
}

const Ctx = createContext<LiveModeCtx>({
  mode: { kind: 'live' },
  setMode: () => undefined,
  markUnavailable: () => undefined,
});

export function LiveModeProvider({
  initial = { kind: 'live' },
  children,
}: {
  initial?: LiveMode;
  children: ReactNode;
}) {
  const [mode, setMode] = useState<LiveMode>(initial);
  const markUnavailable = useCallback(
    (reason: string) =>
      setMode((cur) =>
        cur.kind === 'unavailable' && cur.reason === reason ? cur : { kind: 'unavailable', reason },
      ),
    [],
  );
  const value = useMemo(() => ({ mode, setMode, markUnavailable }), [mode, markUnavailable]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useLiveMode = () => useContext(Ctx);

/**
 * Detects oRPC errors that indicate the backend procedure isn't wired
 * yet (Phase 2.X scaffolding). Reused by the route layer to flip
 * LiveMode → unavailable so the UI shows a banner instead of an
 * indefinitely-pending state.
 */
export const isBackendNotImplemented = (e: unknown): boolean => {
  const msg = (e as Error | undefined)?.message ?? '';
  const code = (e as { code?: string } | undefined)?.code;
  return code === 'NOT_IMPLEMENTED' || /NOT_IMPLEMENTED|501/i.test(msg);
};
