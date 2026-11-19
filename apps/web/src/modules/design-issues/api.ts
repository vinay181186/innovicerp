import type { ListDesignIssuesQuery, ListDesignIssuesResponse } from '@innovic/shared';
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
      q.sf ?? null,
      q.limit,
      q.offset,
    ] as const,
};

function buildQs(q: ListDesignIssuesQuery): string {
  const p = new URLSearchParams();
  if (q.search) p.set('search', q.search);
  if (q.filter) p.set('filter', q.filter);
  if (q.sf) p.set('sf', q.sf);
  p.set('limit', String(q.limit));
  p.set('offset', String(q.offset));
  return p.toString();
}

/** One page of GET /design-issues — the list hook's fetcher, also used by the
 *  shared Export (ADR-310). */
export function fetchDesignIssuesPage(
  query: ListDesignIssuesQuery,
): Promise<ListDesignIssuesResponse> {
  return apiFetch<ListDesignIssuesResponse>(`/design-issues?${buildQs(query)}`);
}

export function useDesignIssuesAll(query: ListDesignIssuesQuery) {
  return useQuery<ListDesignIssuesResponse>({
    queryKey: designIssuesKeys.list(query),
    queryFn: () => fetchDesignIssuesPage(query),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}
