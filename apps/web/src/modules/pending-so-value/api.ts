import type { PendingSoValueQuery, PendingSoValueResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

/** What the screen sends: the SO Filter (defaults to open on the server). */
export type PendingSoValueParams = Partial<PendingSoValueQuery>;

export const pendingSoValueKeys = {
  all: ['pending-so-value'] as const,
  list: (q: PendingSoValueParams) =>
    [
      ...pendingSoValueKeys.all,
      q.filter ?? 'open',
      q.search ?? null,
      q.sf ?? null,
      q.limit ?? null,
      q.offset ?? null,
    ] as const,
};

function buildSearch(q: PendingSoValueParams): string {
  const params = new URLSearchParams();
  params.set('filter', q.filter ?? 'open');
  if (q.search) params.set('search', q.search);
  if (q.sf) params.set('sf', q.sf);
  if (q.limit !== undefined) params.set('limit', String(q.limit));
  if (q.offset !== undefined) params.set('offset', String(q.offset));
  return `?${params.toString()}`;
}

export function usePendingSoValue(q: PendingSoValueParams) {
  return useQuery<PendingSoValueResponse>({
    queryKey: pendingSoValueKeys.list(q),
    queryFn: () => apiFetch<PendingSoValueResponse>(`/pending-so-value${buildSearch(q)}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}
