import type { Citation } from '@package/contracts/shared';
import { type ReactNode, createContext, useCallback, useContext, useState } from 'react';
import { CitationModal } from './citation-modal.tsx';

interface FlightCtx {
  open: (c: Citation) => void;
  close: () => void;
  active: Citation | null;
}

const Ctx = createContext<FlightCtx | null>(null);

export const CitationFlightProvider = ({ children }: { children: ReactNode }) => {
  const [active, setActive] = useState<Citation | null>(null);
  const open = useCallback((c: Citation) => setActive(c), []);
  const close = useCallback(() => setActive(null), []);
  return (
    <Ctx.Provider value={{ active, open, close }}>
      {children}
      <CitationModal />
    </Ctx.Provider>
  );
};

export const useCitationFlight = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('CitationFlightProvider missing');
  return v;
};
