import type {
  AdjustStockInput,
  ListStoreInventoryQuery,
  ListStoreInventoryResponse,
  SetMinStockInput,
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

export function useStoreInventory(query: ListStoreInventoryQuery) {
  return useQuery<ListStoreInventoryResponse>({
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

export function useSetMinStock() {
  const qc = useQueryClient();
  return useMutation<{ ok: true; minQty: number }, Error, SetMinStockInput>({
    mutationFn: (input) =>
      apiFetch<{ ok: true; minQty: number }>('/store-inventory/set-min', {
        method: 'POST',
        json: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: storeInventoryKeys.all });
    },
  });
}
