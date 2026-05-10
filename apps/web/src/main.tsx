/// <reference types="vite/client" />
import './styles/index.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.tsx';

const enableMocks = async () => {
  // MSW is opt-in via VITE_USE_MSW=true so the real API isn't shadowed by
  // the mock service worker in dev. Earlier this was always-on in dev,
  // which meant every /rpc/* call returned an unhandled-request error and
  // the page silently broke against the running wrangler backend.
  if (import.meta.env.DEV && import.meta.env.VITE_USE_MSW === 'true') {
    const { worker } = await import('./mocks/browser.ts');
    await worker.start({
      onUnhandledRequest: (req, print) => {
        if (new URL(req.url).pathname.startsWith('/rpc/')) {
          print.error();
        }
      },
    });
    return;
  }
  // If a previous session installed the service worker, unregister it so a
  // hard reload doesn't leave the page intercepted forever.
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const r of registrations) {
      if (r.active?.scriptURL.endsWith('/mockServiceWorker.js')) {
        await r.unregister();
      }
    }
  }
};

const queryClient = new QueryClient();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('root element missing');

void enableMocks().then(() => {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>,
  );
});
