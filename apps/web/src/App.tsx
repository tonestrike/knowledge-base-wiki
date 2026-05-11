import { RouterProvider } from 'react-router-dom';
import { ChatDockProvider } from './components/chat-dock/chat-dock-context.tsx';
import { ChatDock } from './components/chat-dock/chat-dock.tsx';
import { CitationFlightProvider } from './components/citation/use-citation-flight.tsx';
import { BackendUnavailableBanner } from './components/states/backend-unavailable-banner.tsx';
import { LiveModeProvider } from './lib/live-mode.tsx';
import { router } from './router.tsx';

export function App() {
  // Layout: BackendUnavailableBanner stacked on top, then a horizontal
  // flex row with the router outlet on the left and the persistent chat
  // dock on the right. When the dock is closed its width animates to 0
  // so the router content fills the viewport; opening the dock shrinks
  // the content column rather than overlaying it (the user wanted to
  // keep the wiki page visible while chatting).
  return (
    <LiveModeProvider>
      <ChatDockProvider>
        <CitationFlightProvider>
          <BackendUnavailableBanner />
          <div className="flex min-h-screen w-full">
            <div className="min-w-0 flex-1">
              <RouterProvider router={router} />
            </div>
            <ChatDock />
          </div>
        </CitationFlightProvider>
      </ChatDockProvider>
    </LiveModeProvider>
  );
}
