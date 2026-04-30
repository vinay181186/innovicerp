import type {
  CreateOperatorInput,
  ListOperatorsQuery,
  ListOperatorsResponse,
  Operator,
  UpdateOperatorInput,
} from '@innovic/shared';
import {
  type UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const operatorsKeys = {
  all: ['operators'] as const,
  lists: () => [...operatorsKeys.all, 'list'] as const,
  list: (q: ListOperatorsQuery) => [...operatorsKeys.lists(), q] as const,
  details: () => [...operatorsKeys.all, 'detail'] as const,
  detail: (id: string) => [...operatorsKeys.details(), id] as const,
};

function toQueryString(q: ListOperatorsQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (typeof q.isActive === 'boolean') params.set('isActive', String(q.isActive));
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useOperatorsList(
  query: ListOperatorsQuery,
  options?: Omit<UseQueryOptions<ListOperatorsResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListOperatorsResponse>({
    queryKey: operatorsKeys.list(query),
    queryFn: () => apiFetch<ListOperatorsResponse>(`/operators?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useOperator(id: string | undefined) {
  return useQuery<Operator>({
    queryKey: id ? operatorsKeys.detail(id) : operatorsKeys.detail('__missing__'),
    queryFn: () => apiFetch<Operator>(`/operators/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateOperator() {
  const qc = useQueryClient();
  return useMutation<Operator, Error, CreateOperatorInput>({
    mutationFn: (input) => apiFetch<Operator>('/operators', { method: 'POST', json: input }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: operatorsKeys.lists() });
      qc.setQueryData(operatorsKeys.detail(created.id), created);
    },
  });
}

export function useUpdateOperator(id: string) {
  const qc = useQueryClient();
  return useMutation<Operator, Error, UpdateOperatorInput>({
    mutationFn: (input) => apiFetch<Operator>(`/operators/${id}`, { method: 'PATCH', json: input }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: operatorsKeys.lists() });
      qc.setQueryData(operatorsKeys.detail(id), updated);
    },
  });
}

export function useSoftDeleteOperator() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await apiFetch<null>(`/operators/${id}`, { method: 'DELETE' });
    },
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: operatorsKeys.lists() });
      qc.removeQueries({ queryKey: operatorsKeys.detail(id) });
    },
  });
}
