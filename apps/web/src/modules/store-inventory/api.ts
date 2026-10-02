import type {
  AdjustStockInput,
  ListStoreInventoryQuery,
  ListStoreInventoryResponse,
  ReorderListQuery,
  ReorderListResponse,
  ReorderPrInput,
  ReorderPrResult,
  SetReorderInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const storeInventoryKeys = {
  all: ['store-inventory'] as const,
  list: (q: ListStoreInventoryQuery) => [...storeInventoryKeys.all, 'list', q] as const,
};

function buildSearch(q: ListStoreInventoryQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  params.set('filter', q.filter);
  if (q.sf) params.set('sf', q.sf);
  if (q.limit !== undefined) params.set('limit', String(q.limit));
  if (q.offset) params.set('offset', String(q.offset));
  return params.toString();
}

export function useStoreInventory(query: ListStoreInventoryQuery, enabled = true) {
  return useQuery<ListStoreInventoryResponse>({
    enabled,
    queryKey: storeInventoryKeys.list(query),
    queryFn: () => apiFetch<ListStoreInventoryResponse>(`/store-inventory?${buildSearch(query)}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

export function useAdjustStock() {
  const qc = useQueryClient();
  return useMutation<{ ok: true; stockAfter: number }, Error, AdjustStockInput>({
    mutationFn: (input) =>
      apiFetch<{ ok: true; stockAfter: number }>('/store-inventory/adjust', {
        method: 'POST',
        json: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: storeInventoryKeys.all });
      void qc.invalidateQueries({ queryKey: ['store-transactions'] });
      void qc.invalidateQueries({ queryKey: ['items'] });
    },
  });
}

/** ADR-193 phase 5 — Reorder Level + Reorder Qty of one item. */
export function useSetReorder() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, SetReorderInput>({
    mutationFn: ({ itemId, ...body }) =>
      apiFetch(`/store-inventory/items/${itemId}/reorder`, {
        method: 'PATCH',
        json: { itemId, ...body },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: storeInventoryKeys.all });
      void qc.invalidateQueries({ queryKey: ['items'] });
    },
  });
}

/** One page of the items Below Reorder (ADR-201), with suggested PR qty and
 *  vendor, + how many there are in all. */
export function useReorderList(query: ReorderListQuery) {
  return useQuery<ReorderListResponse>({
    queryKey: [...storeInventoryKeys.all, 'reorder-list', query],
    queryFn: () => {
      const p = new URLSearchParams();
      if (query.sf) p.set('sf', query.sf);
      p.set('limit', String(query.limit));
      p.set('offset', String(query.offset));
      return apiFetch<ReorderListResponse>(`/store-inventory/reorder-list?${p.toString()}`);
    },
    placeholderData: (prev) => prev,
  });
}

/** One-click PRs — one Open PR per ticked item (approval as usual). */
export function useRaiseReorderPrs() {
  const qc = useQueryClient();
  return useMutation<ReorderPrResult, Error, ReorderPrInput>({
    mutationFn: (input) =>
      apiFetch<ReorderPrResult>('/store-inventory/reorder-pr', { method: 'POST', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: storeInventoryKeys.all });
      void qc.invalidateQueries({ queryKey: ['purchase-requests'] });
    },
  });
}
