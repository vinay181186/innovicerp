import type {
  CancelJwInvoiceInput,
  CreateJwInvoiceInput,
  JwInvoice,
  JwInvoiceableLinesResponse,
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
  invoiceableLines: (jwId: string) => [...jwInvoicesKeys.all, 'invoiceable-lines', jwId] as const,
};

/** Line options for the New JW Invoice form: To Invoice (Returned − Invoiced)
 *  per JWSO line, the same limit the server checks on save. */
export function useJwInvoiceableLines(jwId: string | undefined) {
  return useQuery<JwInvoiceableLinesResponse>({
    queryKey: jwInvoicesKeys.invoiceableLines(jwId ?? '__none__'),
    queryFn: () => apiFetch<JwInvoiceableLinesResponse>(`/jw-invoices/invoiceable-lines/${jwId}`),
    enabled: Boolean(jwId),
    staleTime: 0,
  });
}

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
    mutationFn: (input) => apiFetch<JwInvoice>('/jw-invoices', { method: 'POST', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jwInvoicesKeys.all });
      // Invoicing bumps job_work_order_lines.invoiced_qty → JW lists change.
      void qc.invalidateQueries({ queryKey: ['job-work-orders'] });
    },
  });
}

/** R5 (ADR-194): cancel an issued JW invoice with a reason. Reverses the billed
 *  qty (drops invoiced_qty) so the line can be re-billed. Reuses jw_create. */
export function useCancelJwInvoice() {
  const qc = useQueryClient();
  return useMutation<JwInvoice, Error, { id: string } & CancelJwInvoiceInput>({
    mutationFn: ({ id, reason }) =>
      apiFetch<JwInvoice>(`/jw-invoices/${id}/cancel`, { method: 'POST', json: { reason } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jwInvoicesKeys.all });
      void qc.invalidateQueries({ queryKey: ['job-work-orders'] });
    },
  });
}
