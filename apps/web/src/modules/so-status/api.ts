import type { SoStatusResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const soStatusKeys = {
  all: ['so-status'] as const,
  detail: (soId: string) => [...soStatusKeys.all, soId] as const,
};

export function useSoStatus(soId: string) {
  return useQuery<SoStatusResponse>({
    queryKey: soStatusKeys.detail(soId),
    queryFn: () => apiFetch<SoStatusResponse>(`/so-status/${soId}`),
    // Read-only dashboard. Refresh on focus + every 60s for op-floor liveness.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
