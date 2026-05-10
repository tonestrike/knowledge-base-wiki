import { RouterProvider } from 'react-router-dom';
import { CitationFlightProvider } from './components/citation/use-citation-flight.tsx';
import { BackendUnavailableBanner } from './components/states/backend-unavailable-banner.tsx';
import { LiveModeProvider } from './lib/live-mode.tsx';
import { router } from './router.tsx';

export function App() {
  return (
    <LiveModeProvider>
      <CitationFlightProvider>
        <BackendUnavailableBanner />
        <RouterProvider router={router} />
      </CitationFlightProvider>
    </LiveModeProvider>
  );
}
