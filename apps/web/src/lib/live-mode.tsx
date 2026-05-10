import { type ReactNode, createContext, useContext, useState } from 'react';

interface LiveModeCtx {
  live: boolean;
  setLive: (v: boolean) => void;
}

const Ctx = createContext<LiveModeCtx>({ live: true, setLive: () => undefined });

/**
 * Toggles whether streaming components subscribe to real SSE endpoints
 * (`live=true`, the default in dev/prod and the demo flow) or consume
 * the in-process mock AsyncIterables directly (`live=false`, used by
 * the design-system route's "static gallery" mode so visual snapshots
 * deterministically render the final state without waiting on timers).
 */
export function LiveModeProvider({
  initial = true,
  children,
}: {
  initial?: boolean;
  children: ReactNode;
}) {
  const [live, setLive] = useState(initial);
  return <Ctx.Provider value={{ live, setLive }}>{children}</Ctx.Provider>;
}

export const useLiveMode = () => useContext(Ctx);
