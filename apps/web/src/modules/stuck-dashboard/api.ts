// Stuck Dashboard data (ADR-201): one 25-row page, search + Sort & Filter on
// the server; the KPI strip (summary) is over every stuck activity.
import type { StuckDashboardQuery, StuckDashboardResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export function useStuckDashboard(query: StuckDashboardQuery) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const qs = p.toString();
  return useQuery<StuckDashboardResponse>({
    queryKey: ['stuck-dashboard', qs],
    queryFn: () => apiFetch<StuckDashboardResponse>(`/stuck-dashboard?${qs}`),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}
