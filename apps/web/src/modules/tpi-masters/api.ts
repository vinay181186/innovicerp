// TPI Master query hooks — a straight sibling of qc-processes/api.ts, because
// TPI Master is the master sitting next to QC Process Master in the Quality
// menu and there is no reason for the two to differ in cache shape.
//
// `code` carries the inspector's NAME (see packages/shared/src/schemas/
// tpi-master.ts); the UI labels it "Inspector Name" everywhere.

import type {
  CreateTpiMasterInput,
  ListTpiMastersQuery,
  ListTpiMastersResponse,
  TpiMaster,
  UpdateTpiMasterInput,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const tpiMastersKeys = {
  all: ['tpi-masters'] as const,
  lists: () => [...tpiMastersKeys.all, 'list'] as const,
  list: (q: ListTpiMastersQuery) => [...tpiMastersKeys.lists(), q] as const,
  details: () => [...tpiMastersKeys.all, 'detail'] as const,
  detail: (id: string) => [...tpiMastersKeys.details(), id] as const,
};

function toQueryString(q: ListTpiMastersQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.isActive !== undefined) params.set('isActive', String(q.isActive));
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useTpiMastersList(
  query: ListTpiMastersQuery,
  options?: Omit<UseQueryOptions<ListTpiMastersResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListTpiMastersResponse>({
    queryKey: tpiMastersKeys.list(query),
    queryFn: () => apiFetch<ListTpiMastersResponse>(`/tpi-masters?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useTpiMaster(id: string | undefined) {
  return useQuery<TpiMaster>({
    queryKey: id ? tpiMastersKeys.detail(id) : tpiMastersKeys.detail('__missing__'),
    queryFn: () => apiFetch<TpiMaster>(`/tpi-masters/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateTpiMaster() {
  const qc = useQueryClient();
  return useMutation<TpiMaster, Error, CreateTpiMasterInput>({
    mutationFn: (input) => apiFetch<TpiMaster>('/tpi-masters', { method: 'POST', json: input }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: tpiMastersKeys.lists() });
      qc.setQueryData(tpiMastersKeys.detail(created.id), created);
    },
  });
}

export function useUpdateTpiMaster(id: string) {
  const qc = useQueryClient();
  return useMutation<TpiMaster, Error, UpdateTpiMasterInput>({
    mutationFn: (input) =>
      apiFetch<TpiMaster>(`/tpi-masters/${id}`, { method: 'PATCH', json: input }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: tpiMastersKeys.lists() });
      qc.setQueryData(tpiMastersKeys.detail(id), updated);
    },
  });
}

export function useSoftDeleteTpiMaster() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await apiFetch<null>(`/tpi-masters/${id}`, { method: 'DELETE' });
    },
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: tpiMastersKeys.lists() });
      qc.removeQueries({ queryKey: tpiMastersKeys.detail(id) });
    },
  });
}
