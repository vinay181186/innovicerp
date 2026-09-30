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
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { activityLogKeys } from '@/modules/activity-log/api';

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
  if (q.excludePartyOwned) params.set('excludePartyOwned', 'true');
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

/** One page of the Item Master, as the list hook fetches it. Exported so an
 *  imperative lookup (e.g. `useItemCodeResolver`) can share the hook's cache key
 *  and fetch through `queryClient.fetchQuery` instead of a second fetch path. */
export function fetchItemsList(query: ListItemsQuery): Promise<ListItemsResponse> {
  return apiFetch<ListItemsResponse>(`/items?${toQueryString(query)}`);
}

export function useItemsList(
  query: ListItemsQuery,
  options?: Omit<UseQueryOptions<ListItemsResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListItemsResponse>({
    queryKey: itemsKeys.list(query),
    queryFn: () => fetchItemsList(query),
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

export function useCreateItem(saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<Item, Error, CreateItemInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<Item>('/items', { method: 'POST', json: input, ...(headers ? { headers } : {}) }),
      ),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
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
  return useMutation<
    BulkCreateItemsResponse,
    Error,
    BulkCreateItemsInput & { saveKey?: SaveKey | undefined }
  >({
    // A big sheet can take over a minute — give it three. Only the real import
    // (dryRun: false) carries the dialog's save key; a preview is not a save,
    // and sharing the key would make the server replay the preview's answer.
    mutationFn: ({ saveKey, ...input }) =>
      withSaveKey(input.dryRun ? undefined : saveKey, (headers) =>
        apiFetch<BulkCreateItemsResponse>('/items/bulk', {
          method: 'POST',
          json: input,
          timeoutMs: 180_000,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (_res, input) => {
      // A preview (dryRun) writes nothing — nothing to reload.
      if (input.dryRun) return;
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      void qc.invalidateQueries({ queryKey: itemsKeys.lists() });
    },
  });
}

export function useUpdateItem(id: string, saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<Item, Error, UpdateItemInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<Item>(`/items/${id}`, {
          method: 'PATCH',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      void qc.invalidateQueries({ queryKey: itemsKeys.lists() });
      qc.setQueryData(itemsKeys.detail(id), updated);
    },
  });
}

export function useSoftDeleteItem() {
  const qc = useQueryClient();
  // ADR-197: a reason is required to move a record to Trash.
  return useMutation<void, Error, { id: string; reason: string }>({
    mutationFn: async ({ id, reason }) => {
      await apiFetch<null>(`/items/${id}`, { method: 'DELETE', json: { reason } });
    },
    onSuccess: (_, { id }) => {
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      void qc.invalidateQueries({ queryKey: itemsKeys.lists() });
      qc.removeQueries({ queryKey: itemsKeys.detail(id) });
    },
  });
}
