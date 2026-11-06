// SO Planning workflow hooks (PL-4b). Read-only queries on /so-planning.
// Plan writes still go through the existing apps/web/src/modules/plans/api.ts.

import type {
  PlanningBomResponse,
  PlanningDetailResponse,
  PlanningLineListQuery,
  PlanningLineListResponse,
  PlanningSoListResponse,
  RaisePlanningPrInput,
  RaisePlanningPrResponse,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { LIVE_FALLBACK_POLL_MS } from '@/lib/live-updates/constants';
import { activityLogKeys } from '@/modules/activity-log/api';

export const soPlanningKeys = {
  all: ['so-planning'] as const,
  list: (qs = '') => [...soPlanningKeys.all, 'list', qs] as const,
  lineList: (qs = '') => [...soPlanningKeys.all, 'line-list', qs] as const,
  detail: (soId: string | null) => [...soPlanningKeys.all, 'detail', soId] as const,
  bom: (soLineId: string | null) => [...soPlanningKeys.all, 'bom', soLineId] as const,
};

/** Level 1 of the Planning screen (ADR-268): one row per open SO / JWSO line.
 *  Sends source + search + Sort & Filter + a 25-row page and gets that page plus
 *  the matching total. `enabled` is off while one order is open, so the list is
 *  not re-worked out behind a screen that does not show it. */
export function usePlanningLineList(q: PlanningLineListQuery, enabled = true) {
  const params = new URLSearchParams();
  if (q.src) params.set('src', q.src);
  if (q.search) params.set('search', q.search);
  if (q.sf) params.set('sf', q.sf);
  if (q.grnPlanPending) params.set('grnPlanPending', q.grnPlanPending);
  if (q.limit !== undefined) params.set('limit', String(q.limit));
  if (q.offset !== undefined) params.set('offset', String(q.offset));
  const qs = params.toString();
  return useQuery<PlanningLineListResponse>({
    queryKey: soPlanningKeys.lineList(qs),
    queryFn: () => apiFetch<PlanningLineListResponse>(`/so-planning/lines${qs ? `?${qs}` : ''}`),
    enabled,
    refetchInterval: LIVE_FALLBACK_POLL_MS,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

/** Open SOs + JWSOs to plan, one row per ORDER — the Create Plan form's picker,
 *  which calls it with no query and gets every order. */
export function usePlanningSoList() {
  return useQuery<PlanningSoListResponse>({
    queryKey: soPlanningKeys.list(),
    queryFn: () => apiFetch<PlanningSoListResponse>('/so-planning'),
    refetchInterval: LIVE_FALLBACK_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

// The ONE description of "fetch one SO's planning detail".
export function planningSoDetailQuery(soId: string) {
  return {
    queryKey: soPlanningKeys.detail(soId),
    queryFn: () => apiFetch<PlanningDetailResponse>(`/so-planning/${soId}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  };
}

export function usePlanningSoDetail(soId: string | null) {
  return useQuery<PlanningDetailResponse>({
    ...planningSoDetailQuery(soId ?? ''),
    // Re-state the key with the raw (possibly null) id so the disabled
    // "no SO selected" entry keeps the exact key it always had.
    queryKey: soPlanningKeys.detail(soId),
    enabled: !!soId,
  });
}

export function usePlanningBom(soId: string | null, soLineId: string | null) {
  return useQuery<PlanningBomResponse>({
    queryKey: soPlanningKeys.bom(soLineId),
    queryFn: () => apiFetch<PlanningBomResponse>(`/so-planning/${soId}/bom/${soLineId}`),
    enabled: !!soId && !!soLineId,
  });
}

/** ADR-171. Raise ONE standard purchase request against a "buy" SO line from
 *  the Planning screen (`POST /so-planning/lines/:soLineId/raise-pr`). SO
 *  lines only — the API refuses a JWSO line. Invalidates every planning query
 *  so the line's PR chips, prQty and the order roll-up refresh together. */
export function useRaisePlanningPr() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ soLineId, ...input }: RaisePlanningPrInput & { soLineId: string }) =>
      apiFetch<RaisePlanningPrResponse>(`/so-planning/lines/${soLineId}/raise-pr`, {
        method: 'POST',
        json: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: soPlanningKeys.all });
      // ADR-197 — the new PR's History row.
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
    },
  });
}
