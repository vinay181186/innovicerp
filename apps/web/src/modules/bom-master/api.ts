// TanStack Query hooks for BOM Master (Phase A item 1 / ADR-028).

import type {
  BomMaster,
  BomMasterDetail,
  CreateBomMasterInput,
  ListBomMastersQuery,
  ListBomMastersResponse,
  UpdateBomMasterInput,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const bomMastersKeys = {
  all: ['bom-masters'] as const,
  lists: () => [...bomMastersKeys.all, 'list'] as const,
  list: (q: ListBomMastersQuery) => [...bomMastersKeys.lists(), q] as const,
  details: () => [...bomMastersKeys.all, 'detail'] as const,
  detail: (id: string) => [...bomMastersKeys.details(), id] as const,
};

function toQueryString(q: ListBomMastersQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.status) params.set('status', q.status);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useBomMastersList(
  query: ListBomMastersQuery,
  options?: Omit<UseQueryOptions<ListBomMastersResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListBomMastersResponse>({
    queryKey: bomMastersKeys.list(query),
    queryFn: () => apiFetch<ListBomMastersResponse>(`/bom-masters?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useBomMaster(id: string | undefined) {
  return useQuery<BomMasterDetail>({
    queryKey: id ? bomMastersKeys.detail(id) : bomMastersKeys.detail('__missing__'),
    queryFn: () => apiFetch<BomMasterDetail>(`/bom-masters/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateBomMaster() {
  const qc = useQueryClient();
  return useMutation<BomMasterDetail, Error, CreateBomMasterInput>({
    mutationFn: (input) =>
      apiFetch<BomMasterDetail>('/bom-masters', { method: 'POST', json: input }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: bomMastersKeys.lists() });
      qc.setQueryData(bomMastersKeys.detail(created.id), created);
    },
  });
}

export function useUpdateBomMaster(id: string) {
  const qc = useQueryClient();
  return useMutation<BomMasterDetail, Error, UpdateBomMasterInput>({
    mutationFn: (input) =>
      apiFetch<BomMasterDetail>(`/bom-masters/${id}`, { method: 'PUT', json: input }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: bomMastersKeys.lists() });
      qc.setQueryData(bomMastersKeys.detail(updated.id), updated);
    },
  });
}

export function useDeleteBomMaster() {
  const qc = useQueryClient();
  return useMutation<BomMaster, Error, string>({
    mutationFn: (id) => apiFetch<BomMaster>(`/bom-masters/${id}`, { method: 'DELETE' }),
    onSuccess: (_deleted, id) => {
      void qc.invalidateQueries({ queryKey: bomMastersKeys.lists() });
      void qc.invalidateQueries({ queryKey: bomMastersKeys.detail(id) });
    },
  });
}
