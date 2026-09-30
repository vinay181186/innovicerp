import type {
  AddPaymentInput,
  CreateInvoiceInput,
  FinanceSoOption,
  InvoiceDetail,
  InvoiceableSoResponse,
  ListInvoicesResponse,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { activityLogKeys } from '@/modules/activity-log/api';

export const invoiceKeys = {
  all: ['invoices'] as const,
  list: () => [...invoiceKeys.all, 'list'] as const,
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

export function useInvoiceList() {
  return useQuery<ListInvoicesResponse>({
    queryKey: invoiceKeys.list(),
    queryFn: () => apiFetch<ListInvoicesResponse>('/invoices'),
    staleTime: 15_000,
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
