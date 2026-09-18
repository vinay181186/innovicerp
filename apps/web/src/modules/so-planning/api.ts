// SO Planning workflow hooks (PL-4b). Read-only queries on /so-planning.
// Plan writes still go through the existing apps/web/src/modules/plans/api.ts.

import type {
  PlanningBomResponse,
  PlanningDetailResponse,
  PlanningSoListResponse,
  RaisePlanningPrInput,
  RaisePlanningPrResponse,
} from '@innovic/shared';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
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

// The ONE description of "fetch one SO's planning detail". Both the single-SO
// hook and the many-SO search hook spread this, so they share one query key and
// one fetch: a detail loaded for the search results is the same cache entry the
// right pane reads when the user clicks that result — it opens instantly, and a
// refetch from either side updates both.
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

/** Details for several SOs at once — the Planning page's search-results view,
 *  which lists matching LINES across every SO the search hit. One query per SO
 *  (no bulk endpoint, none needed: the caller caps the list), each on the same
 *  key + fetch as `usePlanningSoDetail`, so nothing is fetched twice. */
export function usePlanningSoDetails(soIds: string[]) {
  return useQueries({ queries: soIds.map((id) => planningSoDetailQuery(id)) });
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
    },
  });
}
