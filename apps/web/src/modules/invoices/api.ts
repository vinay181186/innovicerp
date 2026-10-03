import type {
  AddPaymentInput,
  CreateInvoiceInput,
  FinanceSoOption,
  InvoiceDetail,
  InvoiceableSoResponse,
  ListInvoicesQuery,
  ListInvoicesResponse,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { activityLogKeys } from '@/modules/activity-log/api';

export const invoiceKeys = {
  all: ['invoices'] as const,
  list: (q?: ListInvoicesQuery) =>
    q ? ([...invoiceKeys.all, 'list', q] as const) : ([...invoiceKeys.all, 'list'] as const),
  detail: (id: string) => [...invoiceKeys.all, 'detail', id] as const,
  soOptions: () => [...invoiceKeys.all, 'so-options'] as const,
  invoiceable: (soId: string) => [...invoiceKeys.all, 'invoiceable', soId] as const,
  nextCode: () => [...invoiceKeys.all, 'next-code'] as const,
};

export function useNextInvoiceCode() {
  return useQuery<{ code: string }>({
    queryKey: invoiceKeys.nextCode(),
    queryFn: () => apiFetch<{ code: string }>('/invoices/next-code'),
    staleTime: 0,
  });
}

function invoiceListQs(q: ListInvoicesQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.limit !== undefined) params.set('limit', String(q.limit));
  if (q.offset) params.set('offset', String(q.offset));
  if (q.sf) params.set('sf', q.sf);
  return params.toString();
}

/** One page of SO invoices (ADR-201) — search / sf / summary run on the server. */
export function fetchInvoiceList(q: ListInvoicesQuery): Promise<ListInvoicesResponse> {
  return apiFetch<ListInvoicesResponse>(`/invoices?${invoiceListQs(q)}`);
}

export function useInvoiceList(q: ListInvoicesQuery) {
  return useQuery<ListInvoicesResponse>({
    queryKey: invoiceKeys.list(q),
    queryFn: () => fetchInvoiceList(q),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
}

export function useInvoice(id: string | undefined) {
  return useQuery<InvoiceDetail>({
    queryKey: id ? invoiceKeys.detail(id) : invoiceKeys.detail('__none__'),
    queryFn: () => apiFetch<InvoiceDetail>(`/invoices/${id}`),
    enabled: Boolean(id),
  });
}

export function useFinanceSoOptions() {
  return useQuery<{ options: FinanceSoOption[] }>({
    queryKey: invoiceKeys.soOptions(),
    queryFn: () => apiFetch<{ options: FinanceSoOption[] }>('/customer-dispatches/so-options'),
    staleTime: 30_000,
  });
}

export function useInvoiceableSo(soId: string | undefined) {
  return useQuery<InvoiceableSoResponse>({
    queryKey: soId ? invoiceKeys.invoiceable(soId) : invoiceKeys.invoiceable('__none__'),
    queryFn: () => apiFetch<InvoiceableSoResponse>(`/invoices/invoiceable/${soId}`),
    enabled: Boolean(soId),
  });
}

export function useCreateInvoice(saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<InvoiceDetail, Error, CreateInvoiceInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<InvoiceDetail>('/invoices', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: invoiceKeys.all });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
    },
  });
}

export function useAddPayment(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation<InvoiceDetail, Error, AddPaymentInput>({
    mutationFn: (input) =>
      apiFetch<InvoiceDetail>(`/invoices/${invoiceId}/payments`, { method: 'POST', json: input }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: invoiceKeys.list() });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      qc.setQueryData(invoiceKeys.detail(invoiceId), updated);
    },
  });
}

/**
 * Cancel an invoice (ADR-202 Phase 3). An invoice is a statutory document, so it
 * gets a reason-logged cancel instead of an edit screen — there is intentionally
 * NO update hook. The reason is required and stored on the cancelled invoice.
 * Invalidates the invoice detail + list + activity log so every view refreshes
 * into the cancelled state.
 */
export function useCancelInvoice(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation<InvoiceDetail, Error, { reason: string }>({
    mutationFn: ({ reason }) =>
      apiFetch<InvoiceDetail>(`/invoices/${invoiceId}/cancel`, { method: 'POST', json: { reason } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: invoiceKeys.detail(invoiceId) });
      void qc.invalidateQueries({ queryKey: invoiceKeys.list() });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
    },
  });
}
