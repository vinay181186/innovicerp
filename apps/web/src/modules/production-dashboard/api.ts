import type { ProductionDashboardResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const productionDashboardKeys = {
  all: ['production-dashboard'] as const,
};

export function useProductionDashboard() {
  return useQuery<ProductionDashboardResponse>({
    queryKey: productionDashboardKeys.all,
    queryFn: () => apiFetch<ProductionDashboardResponse>('/production-dashboard'),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
}
