import type {
  CreateQcProcessInput,
  DocumentEditStagedResult,
  ListQcProcessesQuery,
  ListQcProcessesResponse,
  QcProcess,
  UpdateQcProcessInput,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
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
  if (q.sf) params.set('sf', q.sf);
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

/**
 * ADR-226 — re-read ONE QC process straight from the server, ignoring the cache.
 *
 * `useEditConflict` calls this after a 409 so its retry lands on the version
 * that is actually stored. A cached read would defeat the whole thing: the
 * cache is what went stale in the first place. Mirrors
 * `useFetchNcRegister` in modules/nc-register/api.ts.
 */
export function useFetchQcProcess(): (id: string) => Promise<QcProcess> {
  const qc = useQueryClient();
  return useCallback(
    (id: string) =>
      qc.fetchQuery<QcProcess>({
        queryKey: qcProcessesKeys.detail(id),
        queryFn: () => apiFetch<QcProcess>(`/qc-processes/${id}`),
        staleTime: 0,
      }),
    [qc],
  );
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
  // ADR-202 — when the edit-approval gate is on and the QC process is live, the
  // PATCH returns a DocumentEditStagedResult (the edit was staged for approval)
  // instead of the updated row. The edit page reads the union to tell them apart.
  return useMutation<QcProcess | DocumentEditStagedResult, Error, UpdateQcProcessInput>({
    mutationFn: (input) =>
      apiFetch<QcProcess | DocumentEditStagedResult>(`/qc-processes/${id}`, {
        method: 'PATCH',
        json: input,
      }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: qcProcessesKeys.lists() });
      if ('staged' in updated) {
        // Nothing changed on the QC process itself — refresh so the detail page
        // shows the new pending-change chips and the inbox picks up the request.
        void qc.invalidateQueries({ queryKey: qcProcessesKeys.detail(id) });
        void qc.invalidateQueries({ queryKey: ['document-edits'] });
        return;
      }
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
