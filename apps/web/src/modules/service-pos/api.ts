import type {
  CreateServicePoInput,
  ListServicePosQuery,
  ListServicePosResponse,
  ServicePoDetail,
  UpdateServicePoInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const servicePosKeys = {
  all: ['service-pos'] as const,
  lists: () => [...servicePosKeys.all, 'list'] as const,
  list: (q: ListServicePosQuery) => [...servicePosKeys.lists(), q] as const,
  details: () => [...servicePosKeys.all, 'detail'] as const,
  detail: (id: string) => [...servicePosKeys.details(), id] as const,
};

function toQueryString(q: ListServicePosQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.status) params.set('status', q.status);
  if (q.vendorId) params.set('vendorId', q.vendorId);
  if (q.fromDate) params.set('fromDate', q.fromDate);
  if (q.toDate) params.set('toDate', q.toDate);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useServicePosList(
  query: ListServicePosQuery,
  options?: Omit<UseQueryOptions<ListServicePosResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListServicePosResponse>({
    queryKey: servicePosKeys.list(query),
    queryFn: () => apiFetch<ListServicePosResponse>(`/service-pos?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useServicePo(id: string | undefined) {
  return useQuery<ServicePoDetail>({
    queryKey: id ? servicePosKeys.detail(id) : servicePosKeys.detail('__missing__'),
    queryFn: () => apiFetch<ServicePoDetail>(`/service-pos/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateServicePo() {
  const qc = useQueryClient();
  return useMutation<ServicePoDetail, Error, CreateServicePoInput>({
    mutationFn: (input) => apiFetch<ServicePoDetail>('/service-pos', { method: 'POST', json: input }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: servicePosKeys.lists() });
      qc.setQueryData(servicePosKeys.detail(created.id), created);
    },
  });
}

export function useUpdateServicePo(id: string) {
  const qc = useQueryClient();
  return useMutation<ServicePoDetail, Error, UpdateServicePoInput>({
    mutationFn: (input) =>
      apiFetch<ServicePoDetail>(`/service-pos/${id}`, { method: 'PATCH', json: input }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: servicePosKeys.lists() });
      qc.setQueryData(servicePosKeys.detail(updated.id), updated);
    },
  });
}

export function useApproveServicePo() {
  const qc = useQueryClient();
  return useMutation<ServicePoDetail, Error, string>({
    mutationFn: (id) => apiFetch<ServicePoDetail>(`/service-pos/${id}/approve`, { method: 'POST' }),
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: servicePosKeys.lists() });
      qc.setQueryData(servicePosKeys.detail(saved.id), saved);
    },
  });
}

export function useSoftDeleteServicePo() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await apiFetch<null>(`/service-pos/${id}`, { method: 'DELETE' });
    },
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: servicePosKeys.lists() });
      qc.removeQueries({ queryKey: servicePosKeys.detail(id) });
    },
  });
}
