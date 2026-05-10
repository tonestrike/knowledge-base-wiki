/// <reference types="vite/client" />
import './styles/index.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.tsx';

const enableMocks = async () => {
  if (import.meta.env.DEV) {
    const { worker } = await import('./mocks/browser.ts');
    // SF6 — error on any unhandled `/rpc/*` request so a missed mock
    // route in dev blows up loudly instead of silently returning a 404.
    // Non-rpc traffic (HTML, vite assets, /api/*) is still bypassed so
    // the rest of the app works normally.
    await worker.start({
      onUnhandledRequest: (req, print) => {
        if (new URL(req.url).pathname.startsWith('/rpc/')) {
          print.error();
        }
      },
    });
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
