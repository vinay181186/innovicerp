import type {
  DailyTaskReportDetail,
  ListDailyTaskReportsQuery,
  ListDailyTaskReportsResponse,
  UpsertDailyTaskReportInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export type DailyReportFilters = ListDailyTaskReportsQuery;

export const dailyTaskReportKeys = {
  all: ['daily-task-reports'] as const,
  list: (f: DailyReportFilters) => [...dailyTaskReportKeys.all, 'list', f] as const,
  detail: (id: string) => [...dailyTaskReportKeys.all, 'detail', id] as const,
};

function toQuery(f: DailyReportFilters): string {
  const p = new URLSearchParams();
  if (f.userId) p.set('userId', f.userId);
  if (f.dateFrom) p.set('dateFrom', f.dateFrom);
  if (f.dateTo) p.set('dateTo', f.dateTo);
  if (f.search) p.set('search', f.search);
  if (f.sf) p.set('sf', f.sf);
  if (f.limit !== undefined) p.set('limit', String(f.limit));
  if (f.offset) p.set('offset', String(f.offset));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function useDailyReportList(filters: DailyReportFilters) {
  return useQuery<ListDailyTaskReportsResponse>({
    queryKey: dailyTaskReportKeys.list(filters),
    queryFn: () => apiFetch<ListDailyTaskReportsResponse>(`/daily-task-reports${toQuery(filters)}`),
    staleTime: 15_000,
    // The old page stays on screen while the next one loads.
    placeholderData: (prev) => prev,
  });
}

export function useDailyReportDetail(id: string | undefined) {
  return useQuery<DailyTaskReportDetail>({
    queryKey: id ? dailyTaskReportKeys.detail(id) : dailyTaskReportKeys.detail('__none__'),
    queryFn: () => apiFetch<DailyTaskReportDetail>(`/daily-task-reports/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateDailyReport() {
  const qc = useQueryClient();
  return useMutation<DailyTaskReportDetail, Error, UpsertDailyTaskReportInput>({
    mutationFn: (input) =>
      apiFetch<DailyTaskReportDetail>('/daily-task-reports', { method: 'POST', json: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: dailyTaskReportKeys.all }),
  });
}

export function useUpdateDailyReport(id: string) {
  const qc = useQueryClient();
  return useMutation<DailyTaskReportDetail, Error, UpsertDailyTaskReportInput>({
    mutationFn: (input) =>
      apiFetch<DailyTaskReportDetail>(`/daily-task-reports/${id}`, { method: 'PUT', json: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: dailyTaskReportKeys.all }),
  });
}
