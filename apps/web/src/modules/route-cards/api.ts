// TanStack Query hooks for Route Cards (Phase A item 2 / ADR-028).

import type {
  CreateRouteCardInput,
  ListRouteCardsQuery,
  ListRouteCardsResponse,
  RouteCard,
  RouteCardDetail,
  UpdateRouteCardInput,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const routeCardsKeys = {
  all: ['route-cards'] as const,
  lists: () => [...routeCardsKeys.all, 'list'] as const,
  list: (q: ListRouteCardsQuery) => [...routeCardsKeys.lists(), q] as const,
  details: () => [...routeCardsKeys.all, 'detail'] as const,
  detail: (id: string) => [...routeCardsKeys.details(), id] as const,
};

function toQueryString(q: ListRouteCardsQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.itemId) params.set('itemId', q.itemId);
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

export function useCreateRouteCard() {
  const qc = useQueryClient();
  return useMutation<RouteCardDetail, Error, CreateRouteCardInput>({
    mutationFn: (input) =>
      apiFetch<RouteCardDetail>('/route-cards', { method: 'POST', json: input }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: routeCardsKeys.lists() });
      qc.setQueryData(routeCardsKeys.detail(created.id), created);
    },
  });
}

export function useUpdateRouteCard(id: string) {
  const qc = useQueryClient();
  return useMutation<RouteCardDetail, Error, UpdateRouteCardInput>({
    mutationFn: (input) =>
      apiFetch<RouteCardDetail>(`/route-cards/${id}`, { method: 'PUT', json: input }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: routeCardsKeys.lists() });
      qc.setQueryData(routeCardsKeys.detail(updated.id), updated);
    },
  });
}

export function useDeleteRouteCard() {
  const qc = useQueryClient();
  return useMutation<RouteCard, Error, string>({
    mutationFn: (id) => apiFetch<RouteCard>(`/route-cards/${id}`, { method: 'DELETE' }),
    onSuccess: (_deleted, id) => {
      void qc.invalidateQueries({ queryKey: routeCardsKeys.lists() });
      void qc.invalidateQueries({ queryKey: routeCardsKeys.detail(id) });
    },
  });
}
