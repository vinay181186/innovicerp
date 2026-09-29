import type {
  AdjustStockInput,
  ListStoreInventoryQuery,
  ListStoreInventoryResponse,
  ReorderListRow,
  ReorderPrInput,
  ReorderPrResult,
  SetReorderInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const storeInventoryKeys = {
  all: ['store-inventory'] as const,
  list: (q: ListStoreInventoryQuery) =>
    [...storeInventoryKeys.all, 'list', q.search ?? null, q.filter] as const,
};

function buildSearch(q: ListStoreInventoryQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  params.set('filter', q.filter);
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

/** Every item Below Reorder, with suggested PR qty and vendor. */
export function useReorderList() {
  return useQuery<ReorderListRow[]>({
    queryKey: [...storeInventoryKeys.all, 'reorder-list'],
    queryFn: () => apiFetch<ReorderListRow[]>('/store-inventory/reorder-list'),
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
