import type {
  CreateCustomerDispatchInput,
  CustomerDispatchDetail,
  CustomerDispatchRegisterResponse,
  DispatchableSoResponse,
  FinanceSoOption,
  ListCustomerDispatchesResponse,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const dispatchKeys = {
  all: ['customer-dispatches'] as const,
  list: () => [...dispatchKeys.all, 'list'] as const,
  register: () => [...dispatchKeys.all, 'register'] as const,
  detail: (id: string) => [...dispatchKeys.all, 'detail', id] as const,
  soOptions: () => [...dispatchKeys.all, 'so-options'] as const,
  dispatchable: (soId: string) => [...dispatchKeys.all, 'dispatchable', soId] as const,
  nextCode: () => [...dispatchKeys.all, 'next-code'] as const,
};

// Read-only preview of the DSP-#### code the server will assign on save.
export function useNextDispatchCode() {
  return useQuery<{ code: string }>({
    queryKey: dispatchKeys.nextCode(),
    queryFn: () => apiFetch<{ code: string }>('/customer-dispatches/next-code'),
    staleTime: 0,
  });
}

export function useDispatchList() {
  return useQuery<ListCustomerDispatchesResponse>({
    queryKey: dispatchKeys.list(),
    queryFn: () => apiFetch<ListCustomerDispatchesResponse>('/customer-dispatches'),
    staleTime: 15_000,
  });
}

// Single dispatch w/ lines — used by the invoice form to prefill from a dispatch.
export function useDispatchDetail(id: string | undefined) {
  return useQuery<CustomerDispatchDetail>({
    queryKey: id ? dispatchKeys.detail(id) : dispatchKeys.detail('__none__'),
    queryFn: () => apiFetch<CustomerDispatchDetail>(`/customer-dispatches/${id}`),
    enabled: Boolean(id),
  });
}

// Line-grain register (legacy renderDispatchRegister grain).
export function useDispatchRegister() {
  return useQuery<CustomerDispatchRegisterResponse>({
    queryKey: dispatchKeys.register(),
    queryFn: () => apiFetch<CustomerDispatchRegisterResponse>('/customer-dispatches/register'),
    staleTime: 15_000,
  });
}

export function useFinanceSoOptions() {
  return useQuery<{ options: FinanceSoOption[] }>({
    queryKey: dispatchKeys.soOptions(),
    queryFn: () => apiFetch<{ options: FinanceSoOption[] }>('/customer-dispatches/so-options'),
    staleTime: 30_000,
  });
}

export function useDispatchableSo(soId: string | undefined) {
  return useQuery<DispatchableSoResponse>({
    queryKey: soId ? dispatchKeys.dispatchable(soId) : dispatchKeys.dispatchable('__none__'),
    queryFn: () => apiFetch<DispatchableSoResponse>(`/customer-dispatches/dispatchable/${soId}`),
    enabled: Boolean(soId),
  });
}

export function useCreateDispatch() {
  const qc = useQueryClient();
  return useMutation<CustomerDispatchDetail, Error, CreateCustomerDispatchInput>({
    mutationFn: (input) =>
      apiFetch<CustomerDispatchDetail>('/customer-dispatches', { method: 'POST', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dispatchKeys.all });
    },
  });
}

export function useCancelDispatch() {
  const qc = useQueryClient();
  return useMutation<CustomerDispatchDetail, Error, string>({
    mutationFn: (id) =>
      apiFetch<CustomerDispatchDetail>(`/customer-dispatches/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dispatchKeys.all });
    },
  });
}
