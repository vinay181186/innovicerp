import type {
  CreateJwInvoiceInput,
  JwInvoice,
  ListJwInvoicesQuery,
  ListJwInvoicesResponse,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const jwInvoicesKeys = {
  all: ['jw-invoices'] as const,
  lists: () => [...jwInvoicesKeys.all, 'list'] as const,
  // The query is part of the key, so a new search term is a new cache entry
  // and a new fetch — the whole point of moving the match to the server.
  list: (q: ListJwInvoicesQuery) => [...jwInvoicesKeys.lists(), q] as const,
};

/** The register's filters, as a query string. `search` is dropped when empty so
 *  an untouched box is not sent as `search=` — the server treats "absent" and
 *  "empty" alike, but leaving it out keeps the URL and the cache key clean. */
function toQueryString(q: ListJwInvoicesQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useJwInvoicesList(query: ListJwInvoicesQuery) {
  return useQuery<ListJwInvoicesResponse>({
    queryKey: jwInvoicesKeys.list(query),
    queryFn: () => apiFetch<ListJwInvoicesResponse>(`/jw-invoices?${toQueryString(query)}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

export function useCreateJwInvoice() {
  const qc = useQueryClient();
  return useMutation<JwInvoice, Error, CreateJwInvoiceInput>({
    mutationFn: (input) =>
      apiFetch<JwInvoice>('/jw-invoices', { method: 'POST', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jwInvoicesKeys.all });
      // Invoicing bumps job_work_order_lines.invoiced_qty → JW lists change.
      void qc.invalidateQueries({ queryKey: ['job-work-orders'] });
    },
  });
}
