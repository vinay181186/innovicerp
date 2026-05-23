import type { DailyReportQuery, DailyReportResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const dailyReportKeys = {
  all: ['daily-report'] as const,
  view: (q: DailyReportQuery) =>
    [...dailyReportKeys.all, q.date, q.machineId ?? null] as const,
};

function buildQs(q: DailyReportQuery): string {
  const p = new URLSearchParams();
  p.set('date', q.date);
  if (q.machineId) p.set('machineId', q.machineId);
  return p.toString();
}

export function useDailyReport(query: DailyReportQuery) {
  return useQuery<DailyReportResponse>({
    queryKey: dailyReportKeys.view(query),
    queryFn: () => apiFetch<DailyReportResponse>(`/daily-report?${buildQs(query)}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}
