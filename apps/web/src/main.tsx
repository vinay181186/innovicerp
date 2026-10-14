import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ErrorBoundary } from './components/shared/error-boundary';
import { installNumberWheelGuard } from './lib/number-wheel-guard';
import { initSentry } from './lib/sentry';
import { setupAuthListener } from './lib/session';
import './index.css';
import { router } from './router';

initSentry();
// A wheel over a focused qty / rate / number field must never change its value.
installNumberWheelGuard();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // ADR-230 — a screen re-reads when the user comes back to the window or
      // the network returns, so a PC left on another window never shows what
      // it loaded an hour ago. Only stale queries refetch, and a refetch never
      // re-seeds an open form (forms take their values once).
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 1,
    },
  },
});

setupAuthListener(queryClient, router);

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element missing');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
