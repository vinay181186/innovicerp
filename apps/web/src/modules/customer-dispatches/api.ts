import type {
  CreateCustomerDispatchInput,
  CustomerDispatchDetail,
  DispatchableSoResponse,
  FinanceSoOption,
  ListCustomerDispatchesResponse,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const dispatchKeys = {
  all: ['customer-dispatches'] as const,
  list: () => [...dispatchKeys.all, 'list'] as const,
  soOptions: () => [...dispatchKeys.all, 'so-options'] as const,
  dispatchable: (soId: string) => [...dispatchKeys.all, 'dispatchable', soId] as const,
};

export function useDispatchList() {
  return useQuery<ListCustomerDispatchesResponse>({
    queryKey: dispatchKeys.list(),
    queryFn: () => apiFetch<ListCustomerDispatchesResponse>('/customer-dispatches'),
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
