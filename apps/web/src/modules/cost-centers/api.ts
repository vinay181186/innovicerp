import type {
  CostCenter,
  CreateCostCenterInput,
  ListCostCentersQuery,
  ListCostCentersResponse,
  UpdateCostCenterInput,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const costCentersKeys = {
  all: ['cost-centers'] as const,
  lists: () => [...costCentersKeys.all, 'list'] as const,
  list: (q: ListCostCentersQuery) => [...costCentersKeys.lists(), q] as const,
  details: () => [...costCentersKeys.all, 'detail'] as const,
  detail: (id: string) => [...costCentersKeys.details(), id] as const,
};

function toQueryString(q: ListCostCentersQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.isActive !== undefined) params.set('isActive', String(q.isActive));
  if (q.department) params.set('department', q.department);
  if (q.type) params.set('type', q.type);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useCostCentersList(
  query: ListCostCentersQuery,
  options?: Omit<UseQueryOptions<ListCostCentersResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListCostCentersResponse>({
    queryKey: costCentersKeys.list(query),
    queryFn: () => apiFetch<ListCostCentersResponse>(`/cost-centers?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useCostCenter(id: string | undefined) {
  return useQuery<CostCenter>({
    queryKey: id ? costCentersKeys.detail(id) : costCentersKeys.detail('__missing__'),
    queryFn: () => apiFetch<CostCenter>(`/cost-centers/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateCostCenter() {
  const qc = useQueryClient();
  return useMutation<CostCenter, Error, CreateCostCenterInput>({
    mutationFn: (input) => apiFetch<CostCenter>('/cost-centers', { method: 'POST', json: input }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: costCentersKeys.lists() });
      qc.setQueryData(costCentersKeys.detail(created.id), created);
    },
  });
}

export function useUpdateCostCenter(id: string) {
  const qc = useQueryClient();
  return useMutation<CostCenter, Error, UpdateCostCenterInput>({
    mutationFn: (input) =>
      apiFetch<CostCenter>(`/cost-centers/${id}`, { method: 'PATCH', json: input }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: costCentersKeys.lists() });
      qc.setQueryData(costCentersKeys.detail(id), updated);
    },
  });
}

export function useSoftDeleteCostCenter() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await apiFetch<null>(`/cost-centers/${id}`, { method: 'DELETE' });
    },
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: costCentersKeys.lists() });
      qc.removeQueries({ queryKey: costCentersKeys.detail(id) });
    },
  });
}
