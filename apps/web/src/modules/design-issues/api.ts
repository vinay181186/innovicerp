import type {
  ListDesignIssuesQuery,
  ListDesignIssuesResponse,
} from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const designIssuesKeys = {
  all: ['design-issues'] as const,
  list: (q: ListDesignIssuesQuery) =>
    [
      ...designIssuesKeys.all,
      'list',
      q.search ?? null,
      q.filter,
      q.limit,
      q.offset,
    ] as const,
};

function buildQs(q: ListDesignIssuesQuery): string {
  const p = new URLSearchParams();
  if (q.search) p.set('search', q.search);
  if (q.filter) p.set('filter', q.filter);
  p.set('limit', String(q.limit));
  p.set('offset', String(q.offset));
  return p.toString();
}

export function useDesignIssuesAll(query: ListDesignIssuesQuery) {
  return useQuery<ListDesignIssuesResponse>({
    queryKey: designIssuesKeys.list(query),
    queryFn: () => apiFetch<ListDesignIssuesResponse>(`/design-issues?${buildQs(query)}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}
