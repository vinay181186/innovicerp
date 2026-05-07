import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ErrorBoundary } from './components/shared/error-boundary';
import { initSentry } from './lib/sentry';
import { setupAuthListener } from './lib/session';
import './index.css';
import { router } from './router';

initSentry();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
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
