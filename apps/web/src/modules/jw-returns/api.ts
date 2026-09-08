import type {
  CreateJwReturnChallanInput,
  JwReturnChallan,
  ListJwReturnChallansQuery,
  ListJwReturnChallansResponse,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const jwReturnsKeys = {
  all: ['jw-returns'] as const,
  lists: () => [...jwReturnsKeys.all, 'list'] as const,
  // The query is part of the key, so a new search term is a new cache entry
  // and a new fetch — the whole point of moving the match to the server.
  list: (q: ListJwReturnChallansQuery) => [...jwReturnsKeys.lists(), q] as const,
};

/** The register's filters, as a query string. `search` is dropped when empty so
 *  an untouched box is not sent as `search=` — the server treats "absent" and
 *  "empty" alike, but leaving it out keeps the URL and the cache key clean. */
function toQueryString(q: ListJwReturnChallansQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useJwReturnsList(query: ListJwReturnChallansQuery) {
  return useQuery<ListJwReturnChallansResponse>({
    queryKey: jwReturnsKeys.list(query),
    queryFn: () =>
      apiFetch<ListJwReturnChallansResponse>(`/jw-returns?${toQueryString(query)}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

export function useCreateJwReturnChallan() {
  const qc = useQueryClient();
  return useMutation<JwReturnChallan, Error, CreateJwReturnChallanInput>({
    mutationFn: (input) =>
      apiFetch<JwReturnChallan>('/jw-returns', { method: 'POST', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jwReturnsKeys.all });
      // Returning goods may flip the JWSO status to dispatched.
      void qc.invalidateQueries({ queryKey: ['job-work-orders'] });
    },
  });
}

export function useCancelJwReturn() {
  const qc = useQueryClient();
  return useMutation<JwReturnChallan, Error, string>({
    mutationFn: (id) =>
      apiFetch<JwReturnChallan>(`/jw-returns/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jwReturnsKeys.all });
      // Reversing the returned-qty cascade may revert the JWSO status.
      void qc.invalidateQueries({ queryKey: ['job-work-orders'] });
    },
  });
}
