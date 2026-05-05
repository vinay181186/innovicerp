// Saved-reports TanStack Query hooks (T-041b).

import type {
  AdHocSpec,
  CreateSavedReportInput,
  ListSavedReportsResponse,
  ListSourcesResponse,
  RunAdHocResponse,
  SavedReport,
  UpdateSavedReportInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const savedReportsKeys = {
  all: ['saved-reports'] as const,
  sources: () => [...savedReportsKeys.all, 'sources'] as const,
  list: () => [...savedReportsKeys.all, 'list'] as const,
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

export function useSavedReportsList() {
  return useQuery<ListSavedReportsResponse>({
    queryKey: savedReportsKeys.list(),
    queryFn: () => apiFetch<ListSavedReportsResponse>('/saved-reports'),
  });
}

export function useSavedReport(id: string | undefined) {
  return useQuery<SavedReport>({
    queryKey: id ? savedReportsKeys.detail(id) : savedReportsKeys.detail('__missing__'),
    queryFn: () => apiFetch<SavedReport>(`/saved-reports/${id}`),
    enabled: Boolean(id),
  });
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
