import type {
  CreateJwInvoiceInput,
  JwInvoice,
  ListJwInvoicesResponse,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const jwInvoicesKeys = {
  all: ['jw-invoices'] as const,
  list: () => [...jwInvoicesKeys.all, 'list'] as const,
};

export function useJwInvoicesList() {
  return useQuery<ListJwInvoicesResponse>({
    queryKey: jwInvoicesKeys.list(),
    queryFn: () => apiFetch<ListJwInvoicesResponse>('/jw-invoices'),
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
