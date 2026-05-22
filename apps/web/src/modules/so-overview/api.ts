import type {
  SoOverviewDetailResponse,
  SoOverviewQuery,
  SoOverviewResponse,
} from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const soOverviewKeys = {
  all: ['so-overview'] as const,
  list: (q: SoOverviewQuery) => [...soOverviewKeys.all, q.status ?? null, q.search ?? null] as const,
  detail: (soId: string | null) => [...soOverviewKeys.all, 'detail', soId] as const,
};

function buildSearch(q: SoOverviewQuery): string {
  const params = new URLSearchParams();
  if (q.status) params.set('status', q.status);
  if (q.search) params.set('search', q.search);
  const s = params.toString();
  return s.length > 0 ? `?${s}` : '';
}

export function useSoOverview(query: SoOverviewQuery) {
  return useQuery<SoOverviewResponse>({
    queryKey: soOverviewKeys.list(query),
    queryFn: () => apiFetch<SoOverviewResponse>(`/so-overview${buildSearch(query)}`),
    // Read-only summary; refresh on focus + every 60s for floor liveness.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

export function useSoOverviewDetail(soId: string | null) {
  return useQuery<SoOverviewDetailResponse>({
    queryKey: soOverviewKeys.detail(soId),
    queryFn: () => apiFetch<SoOverviewDetailResponse>(`/so-overview/${soId}/detail`),
    enabled: !!soId,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
