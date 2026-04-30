import type {
  CreateMachineInput,
  ListMachinesQuery,
  ListMachinesResponse,
  Machine,
  UpdateMachineInput,
} from '@innovic/shared';
import {
  type UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const machinesKeys = {
  all: ['machines'] as const,
  lists: () => [...machinesKeys.all, 'list'] as const,
  list: (q: ListMachinesQuery) => [...machinesKeys.lists(), q] as const,
  details: () => [...machinesKeys.all, 'detail'] as const,
  detail: (id: string) => [...machinesKeys.details(), id] as const,
};

function toQueryString(q: ListMachinesQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.status) params.set('status', q.status);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useMachinesList(
  query: ListMachinesQuery,
  options?: Omit<UseQueryOptions<ListMachinesResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListMachinesResponse>({
    queryKey: machinesKeys.list(query),
    queryFn: () => apiFetch<ListMachinesResponse>(`/machines?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useMachine(id: string | undefined) {
  return useQuery<Machine>({
    queryKey: id ? machinesKeys.detail(id) : machinesKeys.detail('__missing__'),
    queryFn: () => apiFetch<Machine>(`/machines/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateMachine() {
  const qc = useQueryClient();
  return useMutation<Machine, Error, CreateMachineInput>({
    mutationFn: (input) => apiFetch<Machine>('/machines', { method: 'POST', json: input }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: machinesKeys.lists() });
      qc.setQueryData(machinesKeys.detail(created.id), created);
    },
  });
}

export function useUpdateMachine(id: string) {
  const qc = useQueryClient();
  return useMutation<Machine, Error, UpdateMachineInput>({
    mutationFn: (input) => apiFetch<Machine>(`/machines/${id}`, { method: 'PATCH', json: input }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: machinesKeys.lists() });
      qc.setQueryData(machinesKeys.detail(id), updated);
    },
  });
}

export function useSoftDeleteMachine() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await apiFetch<null>(`/machines/${id}`, { method: 'DELETE' });
    },
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: machinesKeys.lists() });
      qc.removeQueries({ queryKey: machinesKeys.detail(id) });
    },
  });
}
