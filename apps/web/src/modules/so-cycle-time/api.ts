// SO Cycle Time data (ADR-201): the Show filter, the search, Sort & Filter and
// the 25-row page run on the server; the averages come back worked out over
// every matching SO.

import type { SoCycleTimeResponse, SoCycleTimeShow } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { fetchAllPages } from '@/lib/list-paging';

export interface SoCycleTimeParams {
  show: SoCycleTimeShow;
  search: string | undefined;
  sf: string | undefined;
}

function url(p: SoCycleTimeParams, limit: number, offset: number): string {
  const q = new URLSearchParams();
  q.set('show', p.show);
  if (p.search) q.set('search', p.search);
  if (p.sf) q.set('sf', p.sf);
  q.set('limit', String(limit));
  q.set('offset', String(offset));
  return `/so-cycle-time?${q.toString()}`;
}

export function useSoCycleTime(p: SoCycleTimeParams, limit: number, offset: number) {
  return useQuery<SoCycleTimeResponse>({
    queryKey: ['so-cycle-time', p, limit, offset],
    queryFn: () => apiFetch<SoCycleTimeResponse>(url(p, limit, offset)),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

/** Every SO matching the screen's filters — for the Excel export. */
export function fetchAllSoCycleTime(p: SoCycleTimeParams) {
  return fetchAllPages(async (limit, offset) => {
    const res = await apiFetch<SoCycleTimeResponse>(url(p, limit, offset));
    return { items: res.rows, total: res.total };
  });
}
