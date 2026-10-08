// Saved-reports TanStack Query hooks (T-041b).

import type {
  AdHocSpec,
  CreateSavedReportInput,
  ListSavedReportsQuery,
  ListSavedReportsResponse,
  ListSourcesResponse,
  RunAdHocResponse,
  SavedReport,
  UpdateSavedReportInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiFetch } from '@/lib/api';

export const savedReportsKeys = {
  all: ['saved-reports'] as const,
  sources: () => [...savedReportsKeys.all, 'sources'] as const,
  list: () => [...savedReportsKeys.all, 'list'] as const,
  page: (q: ListSavedReportsQuery) => [...savedReportsKeys.list(), q] as const,
  detail: (id: string) => [...savedReportsKeys.all, 'detail', id] as const,
  runs: () => [...savedReportsKeys.all, 'run'] as const,
  run: (id: string) => [...savedReportsKeys.runs(), id] as const,
  preview: (specHash: string) => [...savedReportsKeys.all, 'preview', specHash] as const,
};

export function useSourceCatalog() {
  return useQuery<ListSourcesResponse>({
    queryKey: savedReportsKeys.sources(),
    queryFn: () => apiFetch<ListSourcesResponse>('/saved-reports/sources'),
    staleTime: 5 * 60 * 1000,
  });
}

/** One page of Saved Reports (ADR-201): search + Sort & Filter on the server. */
export function useSavedReportsList(q: ListSavedReportsQuery) {
  return useQuery<ListSavedReportsResponse>({
    queryKey: savedReportsKeys.page(q),
    queryFn: () => {
      const params = new URLSearchParams();
      if (q.search) params.set('search', q.search);
      if (q.sf) params.set('sf', q.sf);
      if (q.limit !== undefined) params.set('limit', String(q.limit));
      if (q.offset !== undefined) params.set('offset', String(q.offset));
      return apiFetch<ListSavedReportsResponse>(`/saved-reports?${params.toString()}`);
    },
    placeholderData: (prev) => prev,
  });
}

export function useSavedReport(id: string | undefined) {
  return useQuery<SavedReport>({
    queryKey: id ? savedReportsKeys.detail(id) : savedReportsKeys.detail('__missing__'),
    queryFn: () => apiFetch<SavedReport>(`/saved-reports/${id}`),
    enabled: Boolean(id),
  });
}

/** Re-read ONE saved report from the server, bypassing the cache (ADR-226).
 *
 *  Only used after a save was refused 409 `edit_conflict`: the edit screen needs
 *  the row AS IT IS NOW to work out which fields the other person changed and to
 *  retry onto their version. `staleTime: 0` is the whole point — the cached copy
 *  is the stale photograph we are trying to get past.
 *
 *  It does NOT touch the builder. `<Builder>` seeds every box and the whole
 *  canvas from `initial` in `useState` initialisers and never re-reads the prop,
 *  and this screen does not key or unmount it on a refetch — so a re-read can
 *  never throw away what the user is halfway through building. */
export function useFetchSavedReport(): (id: string) => Promise<SavedReport> {
  const qc = useQueryClient();
  return useCallback(
    (id: string) =>
      qc.fetchQuery<SavedReport>({
        queryKey: savedReportsKeys.detail(id),
        queryFn: () => apiFetch<SavedReport>(`/saved-reports/${id}`),
        staleTime: 0,
      }),
    [qc],
  );
}

export function useSavedReportRun(id: string | undefined) {
  return useQuery<RunAdHocResponse>({
    queryKey: id ? savedReportsKeys.run(id) : savedReportsKeys.run('__missing__'),
    queryFn: () => apiFetch<RunAdHocResponse>(`/saved-reports/${id}/run`),
    enabled: Boolean(id),
    placeholderData: (prev) => prev,
  });
}

export function useCreateSavedReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSavedReportInput) =>
      apiFetch<SavedReport>('/saved-reports', { method: 'POST', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: savedReportsKeys.list() });
    },
  });
}

export function useUpdateSavedReport(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSavedReportInput) =>
      apiFetch<SavedReport>(`/saved-reports/${id}`, { method: 'PUT', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: savedReportsKeys.list() });
      void qc.invalidateQueries({ queryKey: savedReportsKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: savedReportsKeys.run(id) });
    },
  });
}

export function useDeleteSavedReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/saved-reports/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: savedReportsKeys.list() });
    },
  });
}

export function usePreviewSpec() {
  return useMutation({
    mutationFn: (spec: AdHocSpec) =>
      apiFetch<RunAdHocResponse>('/saved-reports/preview', { method: 'POST', json: spec }),
  });
}
