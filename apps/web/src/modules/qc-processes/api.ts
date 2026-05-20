import type {
  CreateQcProcessInput,
  ListQcProcessesQuery,
  ListQcProcessesResponse,
  QcProcess,
  UpdateQcProcessInput,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const qcProcessesKeys = {
  all: ['qc-processes'] as const,
  lists: () => [...qcProcessesKeys.all, 'list'] as const,
  list: (q: ListQcProcessesQuery) => [...qcProcessesKeys.lists(), q] as const,
  details: () => [...qcProcessesKeys.all, 'detail'] as const,
  detail: (id: string) => [...qcProcessesKeys.details(), id] as const,
};

function toQueryString(q: ListQcProcessesQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.isActive !== undefined) params.set('isActive', String(q.isActive));
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useQcProcessesList(
  query: ListQcProcessesQuery,
  options?: Omit<UseQueryOptions<ListQcProcessesResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListQcProcessesResponse>({
    queryKey: qcProcessesKeys.list(query),
    queryFn: () => apiFetch<ListQcProcessesResponse>(`/qc-processes?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useQcProcess(id: string | undefined) {
  return useQuery<QcProcess>({
    queryKey: id ? qcProcessesKeys.detail(id) : qcProcessesKeys.detail('__missing__'),
    queryFn: () => apiFetch<QcProcess>(`/qc-processes/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateQcProcess() {
  const qc = useQueryClient();
  return useMutation<QcProcess, Error, CreateQcProcessInput>({
    mutationFn: (input) => apiFetch<QcProcess>('/qc-processes', { method: 'POST', json: input }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: qcProcessesKeys.lists() });
      qc.setQueryData(qcProcessesKeys.detail(created.id), created);
    },
  });
}

export function useUpdateQcProcess(id: string) {
  const qc = useQueryClient();
  return useMutation<QcProcess, Error, UpdateQcProcessInput>({
    mutationFn: (input) =>
      apiFetch<QcProcess>(`/qc-processes/${id}`, { method: 'PATCH', json: input }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: qcProcessesKeys.lists() });
      qc.setQueryData(qcProcessesKeys.detail(id), updated);
    },
  });
}

export function useSoftDeleteQcProcess() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await apiFetch<null>(`/qc-processes/${id}`, { method: 'DELETE' });
    },
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: qcProcessesKeys.lists() });
      qc.removeQueries({ queryKey: qcProcessesKeys.detail(id) });
    },
  });
}
