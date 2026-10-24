// TanStack Query hooks for Route Cards (Phase A item 2 / ADR-028).

import type {
  CreateRouteCardInput,
  DocumentEditStagedResult,
  ListRouteCardsQuery,
  ListRouteCardsResponse,
  RouteCard,
  RouteCardDetail,
  UpdateRouteCardInput,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { activityLogKeys } from '@/modules/activity-log/api';
import { approvalsKeys } from '@/modules/approvals/api';

export const routeCardsKeys = {
  all: ['route-cards'] as const,
  lists: () => [...routeCardsKeys.all, 'list'] as const,
  list: (q: ListRouteCardsQuery) => [...routeCardsKeys.lists(), q] as const,
  details: () => [...routeCardsKeys.all, 'detail'] as const,
  detail: (id: string) => [...routeCardsKeys.details(), id] as const,
  nextCode: () => [...routeCardsKeys.all, 'next-code'] as const,
};

function toQueryString(q: ListRouteCardsQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.itemId) params.set('itemId', q.itemId);
  if (q.sf) params.set('sf', q.sf);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useRouteCardsList(
  query: ListRouteCardsQuery,
  options?: Omit<UseQueryOptions<ListRouteCardsResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListRouteCardsResponse>({
    queryKey: routeCardsKeys.list(query),
    queryFn: () => apiFetch<ListRouteCardsResponse>(`/route-cards?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useRouteCard(id: string | undefined) {
  return useQuery<RouteCardDetail>({
    queryKey: id ? routeCardsKeys.detail(id) : routeCardsKeys.detail('__missing__'),
    queryFn: () => apiFetch<RouteCardDetail>(`/route-cards/${id}`),
    enabled: Boolean(id),
  });
}

/** One card's detail on demand (from an event handler, not a render) — served
 *  from the same cache entry useRouteCard reads, fetched when missing/stale. */
export function useFetchRouteCard(): (id: string) => Promise<RouteCardDetail> {
  const qc = useQueryClient();
  return useCallback(
    (id: string) =>
      qc.fetchQuery<RouteCardDetail>({
        queryKey: routeCardsKeys.detail(id),
        queryFn: () => apiFetch<RouteCardDetail>(`/route-cards/${id}`),
      }),
    [qc],
  );
}

export function useNextRouteCardCode(
  options?: Omit<UseQueryOptions<{ code: string }>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<{ code: string }>({
    queryKey: routeCardsKeys.nextCode(),
    queryFn: () => apiFetch<{ code: string }>('/route-cards/next-code'),
    staleTime: 0,
    ...options,
  });
}

export function useCreateRouteCard(saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<RouteCardDetail, Error, CreateRouteCardInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<RouteCardDetail>('/route-cards', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: routeCardsKeys.lists() });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      // ADR-224: start re-asking for the next number while this screen is
      // still mounted, so the next Create screen's FIRST PAINTED FRAME already
      // shows the fresh one. nextCode() is a SIBLING of lists(), not a child,
      // so invalidating the list does not reach it.
      //
      // This line is POLISH, not the fix. `refetchOnMount` is left at the
      // TanStack default (main.tsx overrides only staleTime, focus refetch and
      // retry), so the next mount re-asks anyway and self-corrects in
      // milliseconds. What made the stale number STICK was the `codePrefilled`
      // latch in route-card-form.tsx consuming the cached answer and then
      // ignoring the fresh one, and routes/new.tsx sending the result. Keep
      // those two fixed; deleting them and keeping this line brings the bug
      // back.
      void qc.invalidateQueries({ queryKey: routeCardsKeys.nextCode() });
      qc.setQueryData(routeCardsKeys.detail(created.id), created);
    },
  });
}

export function useUpdateRouteCard(id: string, saveKey?: SaveKey) {
  const qc = useQueryClient();
  // ADR-249 Step B — when the edit-approval gate is on, the PUT returns a
  // DocumentEditStagedResult (the whole routing is held for approval) instead
  // of the updated card. The edit page reads the union to tell them apart.
  return useMutation<RouteCardDetail | DocumentEditStagedResult, Error, UpdateRouteCardInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<RouteCardDetail | DocumentEditStagedResult>(`/route-cards/${id}`, {
          method: 'PUT',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: routeCardsKeys.lists() });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      if ('staged' in updated) {
        // Nothing changed on the card itself — refresh so the detail page
        // shows the pending change, and the inbox picks up the request.
        void qc.invalidateQueries({ queryKey: routeCardsKeys.detail(id) });
        void qc.invalidateQueries({ queryKey: ['document-edits'] });
        return;
      }
      qc.setQueryData(routeCardsKeys.detail(updated.id), updated);
    },
  });
}

export function useDeleteRouteCard() {
  const qc = useQueryClient();
  // ADR-197: a delete carries the reason the user typed.
  return useMutation<RouteCard, Error, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) =>
      apiFetch<RouteCard>(`/route-cards/${id}`, { method: 'DELETE', json: { reason } }),
    onSuccess: (_deleted, { id }) => {
      void qc.invalidateQueries({ queryKey: routeCardsKeys.lists() });
      void qc.invalidateQueries({ queryKey: routeCardsKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      // ADR-227 made the next number "highest code EVER used + 1" — a deleted
      // card keeps its number for ever, so a delete can no longer change what
      // the preview should say. Kept anyway, cheap and harmless: it is one
      // refetch of a tiny endpoint, and if the rule is ever revisited the
      // preview stays correct without anyone remembering this line.
      void qc.invalidateQueries({ queryKey: routeCardsKeys.nextCode() });
    },
  });
}

// ADR-253 — a NEW Route Card is approved (or rejected with a reason) before it
// can be used. Both answer with the card; a 409 (already decided, no right…)
// throws with the server's words, which the caller shows as-is.
function useRouteCardDecision<TVars extends { id: string }>(
  action: 'approve' | 'reject',
  body: (v: TVars) => Record<string, unknown>,
) {
  const qc = useQueryClient();
  return useMutation<RouteCardDetail, Error, TVars>({
    mutationFn: (v) =>
      apiFetch<RouteCardDetail>(`/route-cards/${v.id}/${action}`, {
        method: 'POST',
        json: body(v),
      }),
    onSuccess: (updated) => {
      qc.setQueryData(routeCardsKeys.detail(updated.id), updated);
      void qc.invalidateQueries({ queryKey: routeCardsKeys.lists() });
      void qc.invalidateQueries({ queryKey: routeCardsKeys.detail(updated.id) });
      void qc.invalidateQueries({ queryKey: approvalsKeys.inbox() });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
    },
  });
}

export function useApproveRouteCard() {
  return useRouteCardDecision<{ id: string; remarks?: string }>('approve', (v) =>
    v.remarks ? { remarks: v.remarks } : {},
  );
}

export function useRejectRouteCard() {
  return useRouteCardDecision<{ id: string; reason: string }>('reject', (v) => ({
    reason: v.reason,
  }));
}
