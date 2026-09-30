import type {
  CreateJwReturnChallanInput,
  JwReturnChallan,
  JwReturnChallanListItem,
  JwReturnableResponse,
  ListJwReturnChallansQuery,
  ListJwReturnChallansResponse,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { activityLogKeys } from '@/modules/activity-log/api';

export const jwReturnsKeys = {
  all: ['jw-returns'] as const,
  lists: () => [...jwReturnsKeys.all, 'list'] as const,
  // The query is part of the key, so a new search term is a new cache entry
  // and a new fetch — the whole point of moving the match to the server.
  list: (q: ListJwReturnChallansQuery) => [...jwReturnsKeys.lists(), q] as const,
  detail: (id: string) => [...jwReturnsKeys.all, 'detail', id] as const,
  returnable: (jwId: string) => [...jwReturnsKeys.all, 'returnable', jwId] as const,
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
    queryFn: () => apiFetch<ListJwReturnChallansResponse>(`/jw-returns?${toQueryString(query)}`),
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
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      // Returning goods may flip the JWSO status to dispatched.
      void qc.invalidateQueries({ queryKey: ['job-work-orders'] });
    },
  });
}

/** R10 (ADR-194): cancel an issued JW Return Challan with a reason. Reverses
 *  returned_qty so the goods can be returned again; blocked while an uncancelled
 *  JW invoice still covers the returned qty. Reuses jw_create. */
export function useCancelJwReturn() {
  const qc = useQueryClient();
  return useMutation<JwReturnChallan, Error, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) =>
      apiFetch<JwReturnChallan>(`/jw-returns/${id}/cancel`, { method: 'POST', json: { reason } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jwReturnsKeys.all });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      // Reversing the returned-qty cascade may revert the JWSO status.
      void qc.invalidateQueries({ queryKey: ['job-work-orders'] });
    },
  });
}

/** One return challan as a register row (the print after save reads it). */
export function useJwReturn(id: string | undefined) {
  return useQuery<JwReturnChallanListItem>({
    queryKey: jwReturnsKeys.detail(id ?? '__none__'),
    queryFn: () => apiFetch<JwReturnChallanListItem>(`/jw-returns/${id}`),
    enabled: Boolean(id),
  });
}

/** Per line of one JWSO: Ready / Returned / Pending / Returnable — the same
 *  limit the server enforces on Save. */
export function useJwReturnable(jwId: string | undefined) {
  return useQuery<JwReturnableResponse>({
    queryKey: jwReturnsKeys.returnable(jwId ?? '__none__'),
    queryFn: () => apiFetch<JwReturnableResponse>(`/jw-returns/returnable/${jwId}`),
    enabled: Boolean(jwId),
    staleTime: 0,
  });
}
