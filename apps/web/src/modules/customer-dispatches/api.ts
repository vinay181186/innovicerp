import type {
  CreateCustomerDispatchInput,
  CustomerDispatchDetail,
  CustomerDispatchRegisterQuery,
  CustomerDispatchRegisterResponse,
  DispatchableSoResponse,
  FinanceSoOption,
  ListCustomerDispatchesResponse,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { activityLogKeys } from '@/modules/activity-log/api';

export const dispatchKeys = {
  all: ['customer-dispatches'] as const,
  list: () => [...dispatchKeys.all, 'list'] as const,
  register: (q?: CustomerDispatchRegisterQuery) =>
    q
      ? ([...dispatchKeys.all, 'register', q] as const)
      : ([...dispatchKeys.all, 'register'] as const),
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

function registerQs(q: CustomerDispatchRegisterQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.soNo) params.set('soNo', q.soNo);
  if (q.limit !== undefined) params.set('limit', String(q.limit));
  if (q.offset) params.set('offset', String(q.offset));
  if (q.sf) params.set('sf', q.sf);
  return params.toString();
}

/** One page of the line-grain register, paged by DISPATCH (ADR-201). */
export function fetchDispatchRegister(
  q: CustomerDispatchRegisterQuery,
): Promise<CustomerDispatchRegisterResponse> {
  return apiFetch<CustomerDispatchRegisterResponse>(
    `/customer-dispatches/register?${registerQs(q)}`,
  );
}

// Line-grain register (legacy renderDispatchRegister grain).
export function useDispatchRegister(q: CustomerDispatchRegisterQuery) {
  return useQuery<CustomerDispatchRegisterResponse>({
    queryKey: dispatchKeys.register(q),
    queryFn: () => fetchDispatchRegister(q),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
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

export function useCreateDispatch(saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<CustomerDispatchDetail, Error, CreateCustomerDispatchInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<CustomerDispatchDetail>('/customer-dispatches', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dispatchKeys.all });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
    },
  });
}

/** Cancel reverses the dispatch; the reason is required (ADR-197). */
export function useCancelDispatch() {
  const qc = useQueryClient();
  return useMutation<CustomerDispatchDetail, Error, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) =>
      apiFetch<CustomerDispatchDetail>(`/customer-dispatches/${id}/cancel`, {
        method: 'POST',
        json: { reason },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dispatchKeys.all });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
    },
  });
}
