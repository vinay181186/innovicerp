import type {
  CreateSalesOrderInput,
  ListSalesOrdersQuery,
  ListSalesOrdersResponse,
  SalesOrderDetail,
  UpdateSalesOrderInput,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const salesOrdersKeys = {
  all: ['sales-orders'] as const,
  lists: () => [...salesOrdersKeys.all, 'list'] as const,
  list: (q: ListSalesOrdersQuery) => [...salesOrdersKeys.lists(), q] as const,
  details: () => [...salesOrdersKeys.all, 'detail'] as const,
  detail: (id: string) => [...salesOrdersKeys.details(), id] as const,
};

function toQueryString(q: ListSalesOrdersQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.status) params.set('status', q.status);
  if (q.type) params.set('type', q.type);
  if (q.clientId) params.set('clientId', q.clientId);
  if (q.fromDate) params.set('fromDate', q.fromDate);
  if (q.toDate) params.set('toDate', q.toDate);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useSalesOrdersList(
  query: ListSalesOrdersQuery,
  options?: Omit<UseQueryOptions<ListSalesOrdersResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListSalesOrdersResponse>({
    queryKey: salesOrdersKeys.list(query),
    queryFn: () => apiFetch<ListSalesOrdersResponse>(`/sales-orders?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

/** Fetch every SO row matching the current filters, for export. The list API
 *  caps `limit` at 200, so we page through in 200-row requests until we've
 *  pulled all `total` rows (instead of one oversized request the API rejects). */
export async function fetchSalesOrdersForExport(
  query: ListSalesOrdersQuery,
): Promise<ListSalesOrdersResponse> {
  const PAGE = 200;
  const items: ListSalesOrdersResponse['items'] = [];
  let offset = 0;
  let total = 0;
  // Hard ceiling so a bad `total` can never loop forever (10k SOs max export).
  for (let guard = 0; guard < 50; guard += 1) {
    const res = await apiFetch<ListSalesOrdersResponse>(
      `/sales-orders?${toQueryString({ ...query, limit: PAGE, offset })}`,
    );
    items.push(...res.items);
    total = res.total;
    offset += PAGE;
    if (res.items.length < PAGE || items.length >= total) break;
  }
  return { items, total, limit: items.length, offset: 0 };
}

export function useSalesOrder(id: string | undefined) {
  return useQuery<SalesOrderDetail>({
    queryKey: id ? salesOrdersKeys.detail(id) : salesOrdersKeys.detail('__missing__'),
    queryFn: () => apiFetch<SalesOrderDetail>(`/sales-orders/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateSalesOrder() {
  const qc = useQueryClient();
  return useMutation<SalesOrderDetail, Error, CreateSalesOrderInput>({
    mutationFn: (input) =>
      apiFetch<SalesOrderDetail>('/sales-orders', { method: 'POST', json: input }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: salesOrdersKeys.lists() });
      qc.setQueryData(salesOrdersKeys.detail(created.id), created);
    },
  });
}

export function useUpdateSalesOrder(id: string) {
  const qc = useQueryClient();
  return useMutation<SalesOrderDetail, Error, UpdateSalesOrderInput>({
    mutationFn: (input) =>
      apiFetch<SalesOrderDetail>(`/sales-orders/${id}`, { method: 'PATCH', json: input }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: salesOrdersKeys.lists() });
      qc.setQueryData(salesOrdersKeys.detail(id), updated);
    },
  });
}

export function useSoftDeleteSalesOrder() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await apiFetch<null>(`/sales-orders/${id}`, { method: 'DELETE' });
    },
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: salesOrdersKeys.lists() });
      qc.removeQueries({ queryKey: salesOrdersKeys.detail(id) });
    },
  });
}
