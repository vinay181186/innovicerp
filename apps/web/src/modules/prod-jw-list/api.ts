import type { ListProdJwQuery, ListProdJwResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const prodJwListKeys = {
  all: ['prod-jw-list'] as const,
  list: (q: ListProdJwQuery) =>
    [...prodJwListKeys.all, 'list', q.search ?? null, q.limit, q.offset] as const,
};

function buildQs(q: ListProdJwQuery): string {
  const p = new URLSearchParams();
  if (q.search) p.set('search', q.search);
  p.set('limit', String(q.limit));
  p.set('offset', String(q.offset));
  return p.toString();
}

export function useProdJwList(query: ListProdJwQuery) {
  return useQuery<ListProdJwResponse>({
    queryKey: prodJwListKeys.list(query),
    queryFn: () => apiFetch<ListProdJwResponse>(`/prod-jw-list?${buildQs(query)}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}
