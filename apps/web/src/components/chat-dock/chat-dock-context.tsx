import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

interface ChatDockState {
  open: boolean;
  /** Wiki the dock is currently anchored to. */
  wikiId: string | null;
  toggle: () => void;
  close: () => void;
  openFor: (wikiId: string) => void;
}

const Ctx = createContext<ChatDockState | null>(null);

/**
 * App-wide chat dock controller. Holds the open/closed state of the
 * persistent right-side dock and the wiki it's anchored to. Cmd+K /
 * Ctrl+K toggles. Mounted once at the app root so the dock survives
 * route transitions and can be opened from any page.
 */
export function ChatDockProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [wikiId, setWikiId] = useState<string | null>(null);

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);
  const openFor = useCallback((id: string) => {
    setWikiId(id);
    setOpen(true);
  }, []);

  // Cmd+K / Ctrl+K toggles the dock from anywhere. Escape is wired
  // via Radix Sheet's `onEscapeKeyDown`, so we don't need to handle it here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  const value = useMemo(
    () => ({ open, wikiId, toggle, close, openFor }),
    [open, wikiId, toggle, close, openFor],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChatDock() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useChatDock must be used inside ChatDockProvider');
  return v;
}
