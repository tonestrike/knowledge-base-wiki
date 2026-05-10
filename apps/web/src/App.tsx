import { RouterProvider } from 'react-router-dom';
import { ChatDockProvider } from './components/chat-dock/chat-dock-context.tsx';
import { ChatDock } from './components/chat-dock/chat-dock.tsx';
import { CitationFlightProvider } from './components/citation/use-citation-flight.tsx';
import { BackendUnavailableBanner } from './components/states/backend-unavailable-banner.tsx';
import { LiveModeProvider } from './lib/live-mode.tsx';
import { router } from './router.tsx';

export function App() {
  return (
    <LiveModeProvider>
      <ChatDockProvider>
        <CitationFlightProvider>
          <BackendUnavailableBanner />
          <RouterProvider router={router} />
          {/* Persistent right-side dock — summon with ⌘K from anywhere. */}
          <ChatDock />
        </CitationFlightProvider>
      </ChatDockProvider>
    </LiveModeProvider>
  );
}
