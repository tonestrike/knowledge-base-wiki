import { useLiveMode } from '../../lib/live-mode.tsx';
import { Button } from '../ui/button.tsx';

/**
 * SF5 — surfaces the "backend not ready" state set by `markUnavailable`.
 * Renders when LiveMode is `unavailable`; offers a "Fall back to mocks"
 * action that flips the mode to `static`. Hidden when mode is `live` or
 * `static`.
 */
export function BackendUnavailableBanner() {
  const { mode, setMode } = useLiveMode();
  if (mode.kind !== 'unavailable') return null;
  return (
    <output className="block border-b border-verdict-unsupported/40 bg-verdict-unsupported/10 px-6 py-3 text-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <p>
          <strong className="font-mono text-xs uppercase tracking-widest">Backend not ready</strong>{' '}
          — {mode.reason} Falling back to mock mode renders a deterministic gallery so you can
          continue exploring the UI.
        </p>
        <Button variant="outline" size="sm" onClick={() => setMode({ kind: 'static' })}>
          Fall back to mocks
        </Button>
      </div>
    </output>
  );
}
