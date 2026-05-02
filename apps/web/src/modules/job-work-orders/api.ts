import type {
  CreateJobWorkOrderInput,
  JobWorkOrderDetail,
  ListJobWorkOrdersQuery,
  ListJobWorkOrdersResponse,
  UpdateJobWorkOrderInput,
} from '@innovic/shared';
import {
  type UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const jobWorkOrdersKeys = {
  all: ['job-work-orders'] as const,
  lists: () => [...jobWorkOrdersKeys.all, 'list'] as const,
  list: (q: ListJobWorkOrdersQuery) => [...jobWorkOrdersKeys.lists(), q] as const,
  details: () => [...jobWorkOrdersKeys.all, 'detail'] as const,
  detail: (id: string) => [...jobWorkOrdersKeys.details(), id] as const,
};

function toQueryString(q: ListJobWorkOrdersQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.status) params.set('status', q.status);
  if (q.clientId) params.set('clientId', q.clientId);
  if (q.fromDate) params.set('fromDate', q.fromDate);
  if (q.toDate) params.set('toDate', q.toDate);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useJobWorkOrdersList(
  query: ListJobWorkOrdersQuery,
  options?: Omit<UseQueryOptions<ListJobWorkOrdersResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListJobWorkOrdersResponse>({
    queryKey: jobWorkOrdersKeys.list(query),
    queryFn: () =>
      apiFetch<ListJobWorkOrdersResponse>(`/job-work-orders?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useJobWorkOrder(id: string | undefined) {
  return useQuery<JobWorkOrderDetail>({
    queryKey: id ? jobWorkOrdersKeys.detail(id) : jobWorkOrdersKeys.detail('__missing__'),
    queryFn: () => apiFetch<JobWorkOrderDetail>(`/job-work-orders/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateJobWorkOrder() {
  const qc = useQueryClient();
  return useMutation<JobWorkOrderDetail, Error, CreateJobWorkOrderInput>({
    mutationFn: (input) =>
      apiFetch<JobWorkOrderDetail>('/job-work-orders', { method: 'POST', json: input }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: jobWorkOrdersKeys.lists() });
      qc.setQueryData(jobWorkOrdersKeys.detail(created.id), created);
    },
  });
}

export function useUpdateJobWorkOrder(id: string) {
  const qc = useQueryClient();
  return useMutation<JobWorkOrderDetail, Error, UpdateJobWorkOrderInput>({
    mutationFn: (input) =>
      apiFetch<JobWorkOrderDetail>(`/job-work-orders/${id}`, { method: 'PATCH', json: input }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: jobWorkOrdersKeys.lists() });
      qc.setQueryData(jobWorkOrdersKeys.detail(id), updated);
    },
  });
}

export function useSoftDeleteJobWorkOrder() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await apiFetch<null>(`/job-work-orders/${id}`, { method: 'DELETE' });
    },
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: jobWorkOrdersKeys.lists() });
      qc.removeQueries({ queryKey: jobWorkOrdersKeys.detail(id) });
    },
  });
}
