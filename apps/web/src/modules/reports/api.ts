import {
  type ListReportsResponse,
  REPORT_COLUMN_FILTER_PREFIX,
  type RunReportResponse,
} from '@innovic/shared';
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

/** The grid's own query (ADR-201): the page, the sort and the column
 *  filters — all run on the server over every row of the report. */
export interface ReportGridQuery {
  limit?: number;
  offset?: number;
  sort?: { key: string; dir: 'asc' | 'desc' } | null;
  colFilters?: Readonly<Record<string, string>>;
}

/** Report filters + grid query → the `/reports/:slug` query string. */
export function reportRunParams(
  filters: Record<string, string>,
  grid: ReportGridQuery = {},
): URLSearchParams {
  const params = new URLSearchParams(filters);
  if (grid.limit !== undefined) params.set('_limit', String(grid.limit));
  if (grid.offset) params.set('_offset', String(grid.offset));
  if (grid.sort) {
    params.set('_sort', grid.sort.key);
    params.set('_dir', grid.sort.dir);
  }
  for (const [k, v] of Object.entries(grid.colFilters ?? {})) {
    if (v.trim() !== '') params.set(`${REPORT_COLUMN_FILTER_PREFIX}${k}`, v.trim());
  }
  return params;
}

export function fetchReportRun(
  slug: string,
  filters: Record<string, string>,
  grid: ReportGridQuery = {},
): Promise<RunReportResponse> {
  const qs = reportRunParams(filters, grid).toString();
  return apiFetch<RunReportResponse>(`/reports/${slug}${qs ? `?${qs}` : ''}`);
}

export function useReportRun(
  slug: string | undefined,
  filters: Record<string, string>,
  grid: ReportGridQuery = {},
) {
  return useQuery<RunReportResponse>({
    queryKey: slug ? [...reportsKeys.run(slug, filters), grid] : reportsKeys.run('__missing__', {}),
    queryFn: () => fetchReportRun(slug ?? '', filters, grid),
    enabled: Boolean(slug),
    placeholderData: (prev) => prev,
  });
}
