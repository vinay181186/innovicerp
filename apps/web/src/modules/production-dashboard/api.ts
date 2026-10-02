import type {
  ProductionDashboardJcPage,
  ProductionDashboardPageQuery,
  ProductionDashboardReadyPage,
  ProductionDashboardResponse,
} from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const productionDashboardKeys = {
  all: ['production-dashboard'] as const,
};

/** Whole-company counters + Supply Chain Snapshot. */
export function useProductionDashboard() {
  return useQuery<ProductionDashboardResponse>({
    queryKey: productionDashboardKeys.all,
    queryFn: () => apiFetch<ProductionDashboardResponse>('/production-dashboard'),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
}

function qs(q: ProductionDashboardPageQuery): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  return p.toString();
}

/** ADR-201: one 25-row page of the Available Now board (server Sort & Filter). */
export function useReadyOps(q: ProductionDashboardPageQuery) {
  const s = qs(q);
  return useQuery<ProductionDashboardReadyPage>({
    queryKey: [...productionDashboardKeys.all, 'ready', s],
    queryFn: () => apiFetch<ProductionDashboardReadyPage>(`/production-dashboard/ready?${s}`),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
}

/** ADR-201: one 25-card page of the Open Job Cards widget. */
export function useOpenJobCards(q: ProductionDashboardPageQuery) {
  const s = qs(q);
  return useQuery<ProductionDashboardJcPage>({
    queryKey: [...productionDashboardKeys.all, 'open-job-cards', s],
    queryFn: () => apiFetch<ProductionDashboardJcPage>(`/production-dashboard/open-job-cards?${s}`),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
}
