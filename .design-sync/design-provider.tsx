// Wraps a design like the app shell wraps a screen: tables and item images read through the
// query cache. Queries never fetch here; designs show sample data.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const client = new QueryClient({
  defaultOptions: { queries: { enabled: false, retry: false } },
});

export function DesignProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
