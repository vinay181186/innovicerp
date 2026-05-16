import type { QcDashboardQuery, QcDashboardResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const qcDashboardKeys = {
  all: ['qc-dashboard'] as const,
  detail: (q: QcDashboardQuery) => [...qcDashboardKeys.all, q.month ?? null, q.engineer ?? null],
};

function buildSearch(q: QcDashboardQuery): string {
  const params = new URLSearchParams();
  if (q.month) params.set('month', q.month);
  if (q.engineer) params.set('engineer', q.engineer);
  const s = params.toString();
  return s.length > 0 ? `?${s}` : '';
}

export function useQcDashboard(query: QcDashboardQuery) {
  return useQuery<QcDashboardResponse>({
    queryKey: qcDashboardKeys.detail(query),
    queryFn: () => apiFetch<QcDashboardResponse>(`/qc-dashboard${buildSearch(query)}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
