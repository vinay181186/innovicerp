import type {
  ItemBalance,
  ListStoreTransactionsQuery,
  ListStoreTransactionsResponse,
} from '@innovic/shared';
import { type UseQueryOptions, useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const storeTransactionsKeys = {
  all: ['store-transactions'] as const,
  lists: () => [...storeTransactionsKeys.all, 'list'] as const,
  list: (q: ListStoreTransactionsQuery) => [...storeTransactionsKeys.lists(), q] as const,
  itemBalance: (itemId: string) => [...storeTransactionsKeys.all, 'item-balance', itemId] as const,
};

function toQueryString(q: ListStoreTransactionsQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.itemId) params.set('itemId', q.itemId);
  if (q.txnType) params.set('txnType', q.txnType);
  if (q.sourceType) params.set('sourceType', q.sourceType);
  if (q.fromDate) params.set('fromDate', q.fromDate);
  if (q.toDate) params.set('toDate', q.toDate);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useStoreTransactionsList(
  query: ListStoreTransactionsQuery,
  options?: Omit<UseQueryOptions<ListStoreTransactionsResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListStoreTransactionsResponse>({
    queryKey: storeTransactionsKeys.list(query),
    queryFn: () =>
      apiFetch<ListStoreTransactionsResponse>(`/store-transactions?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useItemBalance(itemId: string | undefined) {
  return useQuery<ItemBalance>({
    queryKey: itemId
      ? storeTransactionsKeys.itemBalance(itemId)
      : storeTransactionsKeys.itemBalance('__missing__'),
    queryFn: () => apiFetch<ItemBalance>(`/store-transactions/item-balance/${itemId}`),
    enabled: Boolean(itemId),
  });
}
