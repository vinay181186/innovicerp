import type { SoStatusResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const soStatusKeys = {
  all: ['so-status'] as const,
  detail: (soId: string) => [...soStatusKeys.all, soId] as const,
};

/** ADR-222 — `opts` is optional and both knobs DEFAULT TO TODAY'S BEHAVIOUR, so
 *  every existing caller is unchanged.
 *  `enabled: false` — do not call at all. This endpoint is a heavy aggregation
 *  (lines, plans, job cards, stock, timelines), so a screen that will not show
 *  the answer must not ask the question.
 *  `live: false` — fetch once instead of polling. The 60s refresh exists for the
 *  op-floor status dashboard; a static parts list does not need it. */
export function useSoStatus(soId: string, opts?: { enabled?: boolean; live?: boolean }) {
  const live = opts?.live ?? true;
  return useQuery<SoStatusResponse>({
    queryKey: soStatusKeys.detail(soId),
    queryFn: () => apiFetch<SoStatusResponse>(`/so-status/${soId}`),
    enabled: opts?.enabled ?? true,
    // Read-only dashboard. Refresh on focus + every 60s for op-floor liveness.
    refetchInterval: live ? 60_000 : false,
    refetchOnWindowFocus: live,
  });
}
