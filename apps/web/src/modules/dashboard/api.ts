import type { DashboardKpisResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const dashboardKeys = {
  all: ['dashboard'] as const,
  kpis: () => [...dashboardKeys.all, 'kpis'] as const,
};

export function useDashboardKpis() {
  return useQuery<DashboardKpisResponse>({
    queryKey: dashboardKeys.kpis(),
    queryFn: () => apiFetch<DashboardKpisResponse>('/dashboard/kpis'),
    // Refresh on focus + every 60s — KPIs are aggregate counts, no point
    // hammering the DB; users will trigger a refresh on tab focus anyway.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
