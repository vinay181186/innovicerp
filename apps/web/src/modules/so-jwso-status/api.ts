// SO / JWSO status by day (ADR-325) — the two reads. Every figure is the
// server's (apps/api/src/modules/so-jwso-status); this file only fetches.
// Refresh: 'on-open' (refresh-policy.ts) — the page's Refresh button re-reads.

import type { SoJwsoStatusDayDetail, SoJwsoStatusDaysResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const soJwsoStatusKeys = {
  all: ['so-jwso-status'] as const,
  days: (from: string, to: string) => [...soJwsoStatusKeys.all, 'days', from, to] as const,
  day: (date: string) => [...soJwsoStatusKeys.all, 'day', date] as const,
};

/** One SO summary + one JWSO summary per day, newest day first. */
export function useSoJwsoDays(from: string, to: string, enabled = true) {
  return useQuery<SoJwsoStatusDaysResponse>({
    queryKey: soJwsoStatusKeys.days(from, to),
    queryFn: () =>
      apiFetch<SoJwsoStatusDaysResponse>(
        `/so-jwso-status/days?${new URLSearchParams({ from, to }).toString()}`,
      ),
    enabled,
    placeholderData: (prev) => prev,
  });
}

/** One day: a row per SO and a row per JWSO. */
export function useSoJwsoDay(date: string) {
  return useQuery<SoJwsoStatusDayDetail>({
    queryKey: soJwsoStatusKeys.day(date),
    queryFn: () =>
      apiFetch<SoJwsoStatusDayDetail>(`/so-jwso-status/day/${encodeURIComponent(date)}`),
  });
}
