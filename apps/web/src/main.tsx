/// <reference types="vite/client" />
import './styles/index.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.tsx';

// MSW has been removed from the app entirely. If a previous session left a
// service-worker registration on this origin (with the old always-on dev
// behavior), unregister it now so a hard reload doesn't keep intercepting
// /rpc/* requests forever. Safe to leave in indefinitely — getRegistrations
// returns [] in browsers without service-worker support.
const purgeOldMockWorker = async () => {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const r of registrations) {
      const url = r.active?.scriptURL ?? '';
      if (url.endsWith('/mockServiceWorker.js')) await r.unregister();
    }
  } catch {
    // Service-worker access can be denied in some embedded contexts; ignore.
  }
};

const queryClient = new QueryClient();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('root element missing');

void purgeOldMockWorker().then(() => {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>,
  );
});
