import type { ListProdSoQuery, ListProdSoResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const prodSoListKeys = {
  all: ['prod-so-list'] as const,
  list: (q: ListProdSoQuery) =>
    [...prodSoListKeys.all, 'list', q.search ?? null, q.limit, q.offset] as const,
};

function buildQs(q: ListProdSoQuery): string {
  const p = new URLSearchParams();
  if (q.search) p.set('search', q.search);
  p.set('limit', String(q.limit));
  p.set('offset', String(q.offset));
  return p.toString();
}

export function useProdSoList(query: ListProdSoQuery) {
  return useQuery<ListProdSoResponse>({
    queryKey: prodSoListKeys.list(query),
    queryFn: () => apiFetch<ListProdSoResponse>(`/prod-so-list?${buildQs(query)}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}
