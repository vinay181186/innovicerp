import type {
  BulkCreateItemsInput,
  BulkCreateItemsResponse,
  CreateItemInput,
  Item,
  ListItemsQuery,
  ListItemsResponse,
  UpdateItemInput,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const itemsKeys = {
  all: ['items'] as const,
  lists: () => [...itemsKeys.all, 'list'] as const,
  list: (q: ListItemsQuery) => [...itemsKeys.lists(), q] as const,
  details: () => [...itemsKeys.all, 'detail'] as const,
  detail: (id: string) => [...itemsKeys.details(), id] as const,
};

function toQueryString(q: ListItemsQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.itemType) params.set('itemType', q.itemType);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useItemsList(
  query: ListItemsQuery,
  options?: Omit<UseQueryOptions<ListItemsResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListItemsResponse>({
    queryKey: itemsKeys.list(query),
    queryFn: () => apiFetch<ListItemsResponse>(`/items?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useNextItemCode() {
  return useQuery<{ code: string }>({
    queryKey: [...itemsKeys.all, 'next-code'],
    queryFn: () => apiFetch<{ code: string }>('/items/next-code'),
    staleTime: 0,
  });
}

export function useItem(id: string | undefined) {
  return useQuery<Item>({
    queryKey: id ? itemsKeys.detail(id) : itemsKeys.detail('__missing__'),
    queryFn: () => apiFetch<Item>(`/items/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateItem() {
  const qc = useQueryClient();
  return useMutation<Item, Error, CreateItemInput>({
    mutationFn: (input) => apiFetch<Item>('/items', { method: 'POST', json: input }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: itemsKeys.lists() });
      qc.setQueryData(itemsKeys.detail(created.id), created);
    },
  });
}

/** Whole-sheet Excel import: ONE request, ONE list reload at the end.
 *
 *  The importer used to loop useCreateItem over the rows, and each success
 *  invalidated the list — so the browser re-downloaded the entire item master
 *  after every row, getting slower as the master grew. The same pattern on the
 *  vendor import measured about one row per second. */
export function useBulkCreateItems() {
  const qc = useQueryClient();
  return useMutation<BulkCreateItemsResponse, Error, BulkCreateItemsInput>({
    mutationFn: (input) =>
      apiFetch<BulkCreateItemsResponse>('/items/bulk', { method: 'POST', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: itemsKeys.lists() });
    },
  });
}

export function useUpdateItem(id: string) {
  const qc = useQueryClient();
  return useMutation<Item, Error, UpdateItemInput>({
    mutationFn: (input) => apiFetch<Item>(`/items/${id}`, { method: 'PATCH', json: input }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: itemsKeys.lists() });
      qc.setQueryData(itemsKeys.detail(id), updated);
    },
  });
}

export function useSoftDeleteItem() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await apiFetch<null>(`/items/${id}`, { method: 'DELETE' });
    },
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: itemsKeys.lists() });
      qc.removeQueries({ queryKey: itemsKeys.detail(id) });
    },
  });
}
