import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from './ui/button.tsx';

const STORAGE_KEY = 'tenex.theme';

type Theme = 'light' | 'dark';

/**
 * Read the persisted theme. Wrapped in try/catch (SF10): Safari Private
 * Browsing throws SecurityError on `window.localStorage`, and Chrome can
 * throw QuotaExceededError when storage is full. Either case used to
 * crash the whole tree — now it falls back to system preference.
 */
const readPersisted = (): Theme | null => {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
};

const writePersisted = (theme: Theme): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Persistence is best-effort; in-memory state already reflects the
    // user's choice for this session.
  }
};

const systemPreference = (): Theme => {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => readPersisted() ?? systemPreference());

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('dark', theme === 'dark');
    writePersisted(theme);
  }, [theme]);

  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Switch to ${next} mode`}
      onClick={() => setTheme(next)}
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
