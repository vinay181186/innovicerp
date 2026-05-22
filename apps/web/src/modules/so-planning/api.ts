// SO Planning workflow hooks (PL-4b). Read-only queries on /so-planning.
// Plan writes still go through the existing apps/web/src/modules/plans/api.ts.

import type {
  PlanningBomResponse,
  PlanningDetailResponse,
  PlanningSoListResponse,
} from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const soPlanningKeys = {
  all: ['so-planning'] as const,
  list: () => [...soPlanningKeys.all, 'list'] as const,
  detail: (soId: string | null) => [...soPlanningKeys.all, 'detail', soId] as const,
  bom: (soLineId: string | null) => [...soPlanningKeys.all, 'bom', soLineId] as const,
};

export function usePlanningSoList() {
  return useQuery<PlanningSoListResponse>({
    queryKey: soPlanningKeys.list(),
    queryFn: () => apiFetch<PlanningSoListResponse>('/so-planning'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function usePlanningSoDetail(soId: string | null) {
  return useQuery<PlanningDetailResponse>({
    queryKey: soPlanningKeys.detail(soId),
    queryFn: () => apiFetch<PlanningDetailResponse>(`/so-planning/${soId}`),
    enabled: !!soId,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function usePlanningBom(soId: string | null, soLineId: string | null) {
  return useQuery<PlanningBomResponse>({
    queryKey: soPlanningKeys.bom(soLineId),
    queryFn: () => apiFetch<PlanningBomResponse>(`/so-planning/${soId}/bom/${soLineId}`),
    enabled: !!soId && !!soLineId,
  });
}
