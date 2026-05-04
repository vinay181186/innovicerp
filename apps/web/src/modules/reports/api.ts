import type { ListReportsResponse, RunReportResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const reportsKeys = {
  all: ['reports'] as const,
  list: () => [...reportsKeys.all, 'list'] as const,
  runs: () => [...reportsKeys.all, 'run'] as const,
  run: (slug: string, filters: Record<string, string>) =>
    [...reportsKeys.runs(), slug, filters] as const,
};

export function useReportList() {
  return useQuery<ListReportsResponse>({
    queryKey: reportsKeys.list(),
    queryFn: () => apiFetch<ListReportsResponse>('/reports'),
    // Definitions are static — cache aggressively.
    staleTime: 5 * 60 * 1000,
  });
}

export function useReportRun(slug: string | undefined, filters: Record<string, string>) {
  return useQuery<RunReportResponse>({
    queryKey: slug ? reportsKeys.run(slug, filters) : reportsKeys.run('__missing__', {}),
    queryFn: () => {
      const params = new URLSearchParams(filters);
      const qs = params.toString();
      return apiFetch<RunReportResponse>(`/reports/${slug}${qs ? `?${qs}` : ''}`);
    },
    enabled: Boolean(slug),
    placeholderData: (prev) => prev,
  });
}
