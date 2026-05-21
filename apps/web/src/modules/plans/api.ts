import type {
  ListPlansQuery,
  ListPlansResponse,
  PlanningDashboardResponse,
} from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const plansKeys = {
  all: ['plans'] as const,
  list: (q: ListPlansQuery) =>
    [...plansKeys.all, 'list', q.status ?? null, q.planType ?? null, q.search ?? null, q.limit, q.offset] as const,
  dashboard: () => [...plansKeys.all, 'dashboard'] as const,
};

function buildPlansSearch(q: ListPlansQuery): string {
  const params = new URLSearchParams();
  if (q.status) params.set('status', q.status);
  if (q.planType) params.set('planType', q.planType);
  if (q.search) params.set('search', q.search);
  if (q.limit !== undefined) params.set('limit', String(q.limit));
  if (q.offset !== undefined) params.set('offset', String(q.offset));
  const s = params.toString();
  return s.length > 0 ? `?${s}` : '';
}

export function usePlansList(query: ListPlansQuery) {
  return useQuery<ListPlansResponse>({
    queryKey: plansKeys.list(query),
    queryFn: () => apiFetch<ListPlansResponse>(`/plans${buildPlansSearch(query)}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

export function usePlanningDashboard() {
  return useQuery<PlanningDashboardResponse>({
    queryKey: plansKeys.dashboard(),
    queryFn: () => apiFetch<PlanningDashboardResponse>('/planning-dashboard'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
