import type { ListOspWipQuery, ListOspWipResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const ospWipKeys = {
  all: ['osp-wip'] as const,
  list: (q: ListOspWipQuery) => [...ospWipKeys.all, 'list', q] as const,
};

function buildSearch(q: ListOspWipQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  params.set('filter', q.filter);
  if (q.sf) params.set('sf', q.sf);
  if (q.limit !== undefined) params.set('limit', String(q.limit));
  if (q.offset) params.set('offset', String(q.offset));
  return params.toString();
}

export function useOspWip(query: ListOspWipQuery) {
  return useQuery<ListOspWipResponse>({
    queryKey: ospWipKeys.list(query),
    queryFn: () => apiFetch<ListOspWipResponse>(`/osp-wip?${buildSearch(query)}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}
