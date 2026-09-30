// TanStack Query hooks for BOM Master (Phase A item 1 / ADR-028).

import type {
  BomLinkedSoLinesResponse,
  BomMaster,
  BomMasterDetail,
  CreateBomMasterInput,
  ListBomMastersQuery,
  ListBomMastersResponse,
  UpdateBomMasterInput,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { activityLogKeys } from '@/modules/activity-log/api';

export const bomMastersKeys = {
  all: ['bom-masters'] as const,
  lists: () => [...bomMastersKeys.all, 'list'] as const,
  list: (q: ListBomMastersQuery) => [...bomMastersKeys.lists(), q] as const,
  details: () => [...bomMastersKeys.all, 'detail'] as const,
  detail: (id: string) => [...bomMastersKeys.details(), id] as const,
  nextCode: () => [...bomMastersKeys.all, 'next-code'] as const,
  linkedSoLines: (id: string) => [...bomMastersKeys.detail(id), 'linked-so-lines'] as const,
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

/** SO lines built from this BOM (ADR-190) — fetched only when the list is opened. */
export function useBomLinkedSoLines(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: bomMastersKeys.linkedSoLines(id ?? '__missing__'),
    queryFn: () => apiFetch<BomLinkedSoLinesResponse>(`/bom-masters/${id}/linked-so-lines`),
    enabled: !!id && enabled,
  });
}

export function useNextBomNo() {
  return useQuery<{ code: string }>({
    queryKey: bomMastersKeys.nextCode(),
    queryFn: () => apiFetch<{ code: string }>('/bom-masters/next-code'),
    staleTime: 0,
  });
}

export function useCreateBomMaster(saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<BomMasterDetail, Error, CreateBomMasterInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<BomMasterDetail>('/bom-masters', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: bomMastersKeys.lists() });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      qc.setQueryData(bomMastersKeys.detail(created.id), created);
    },
  });
}

export function useUpdateBomMaster(id: string, saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<BomMasterDetail, Error, UpdateBomMasterInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<BomMasterDetail>(`/bom-masters/${id}`, {
          method: 'PUT',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: bomMastersKeys.lists() });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      qc.setQueryData(bomMastersKeys.detail(updated.id), updated);
    },
  });
}

export function useDeleteBomMaster() {
  const qc = useQueryClient();
  // ADR-197: the reason is required by DELETE /bom-masters/:id.
  return useMutation<BomMaster, Error, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) =>
      apiFetch<BomMaster>(`/bom-masters/${id}`, { method: 'DELETE', json: { reason } }),
    onSuccess: (_deleted, { id }) => {
      void qc.invalidateQueries({ queryKey: bomMastersKeys.lists() });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      void qc.invalidateQueries({ queryKey: bomMastersKeys.detail(id) });
    },
  });
}
