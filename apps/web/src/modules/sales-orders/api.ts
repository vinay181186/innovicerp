import type {
  CloseSalesOrderInput,
  CreateSalesOrderInput,
  ListSalesOrdersQuery,
  ListSalesOrdersResponse,
  SalesOrderDetail,
  ShortCloseSalesOrderLineInput,
  UpdateSalesOrderInput,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { activityLogKeys } from '@/modules/activity-log/api';

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
  if (q.sf) params.set('sf', q.sf);
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

// Document traceability for the SO detail page is rendered by the shared
// <RelatedDocsPanel module="sales-orders" id={...} /> component, which fetches
// GET /sales-orders/:id/related itself — no module-specific hook needed.

/** Next suggested SO No. (MAX+1 after the highest IN-SO-#####). Used to prefill
 *  the create form with an editable, overridable suggestion. */
export function useNextSoCode(enabled = true) {
  return useQuery<{ code: string }>({
    queryKey: [...salesOrdersKeys.all, 'next-code'],
    queryFn: () => apiFetch<{ code: string }>('/sales-orders/next-code'),
    enabled,
    staleTime: 0,
  });
}

export function useCreateSalesOrder(saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<SalesOrderDetail, Error, CreateSalesOrderInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<SalesOrderDetail>('/sales-orders', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: salesOrdersKeys.lists() });
      // ADR-197 — the SO's History tab reads the activity log.
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      qc.setQueryData(salesOrdersKeys.detail(created.id), created);
      // ADR-196 — re-read for the fulfilment status the write-back leaves null.
      void qc.invalidateQueries({ queryKey: salesOrdersKeys.detail(created.id) });
    },
  });
}

export function useUpdateSalesOrder(id: string, saveKey?: SaveKey) {
  const qc = useQueryClient();
  // `reason` (ADR-197) rides beside the shared payload: required by the server
  // when the save cancels the SO, and written on a removed / cancelled line.
  return useMutation<SalesOrderDetail, Error, UpdateSalesOrderInput & { reason?: string }>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<SalesOrderDetail>(`/sales-orders/${id}`, {
          method: 'PATCH',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: salesOrdersKeys.lists() });
      // ADR-197 — the SO's History tab reads the activity log.
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      qc.setQueryData(salesOrdersKeys.detail(id), updated);
      // ADR-196 — the write-back carries no fulfilment status or Billed (only
      // the detail read works them out), so re-read the detail behind it.
      void qc.invalidateQueries({ queryKey: salesOrdersKeys.detail(id) });
    },
  });
}

/** ADR-196 — ERPNext "Close" on ONE line: drops its undelivered qty. Reason
 *  required; needs edit + approve on SO Master. Returns the refreshed detail. */
export function useShortCloseSalesOrderLine(soId: string) {
  const qc = useQueryClient();
  return useMutation<SalesOrderDetail, Error, { lineId: string } & ShortCloseSalesOrderLineInput>({
    mutationFn: ({ lineId, reason }) =>
      apiFetch<SalesOrderDetail>(`/sales-order-lines/${lineId}/short-close`, {
        method: 'POST',
        json: { reason },
      }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: salesOrdersKeys.lists() });
      // ADR-197 — the SO's History tab reads the activity log.
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      qc.setQueryData(salesOrdersKeys.detail(soId), updated);
    },
  });
}

/** ADR-196 — ERPNext "Close" on the whole SO: every line with qty still
 *  undelivered is closed short with the one reason. */
export function useCloseSalesOrder(soId: string) {
  const qc = useQueryClient();
  return useMutation<SalesOrderDetail, Error, CloseSalesOrderInput>({
    mutationFn: ({ reason }) =>
      apiFetch<SalesOrderDetail>(`/sales-orders/${soId}/close`, {
        method: 'POST',
        json: { reason },
      }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: salesOrdersKeys.lists() });
      // ADR-197 — the SO's History tab reads the activity log.
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      qc.setQueryData(salesOrdersKeys.detail(soId), updated);
    },
  });
}

export function useSoftDeleteSalesOrder() {
  const qc = useQueryClient();
  // ADR-197 — a reason is required to move an SO to Trash.
  return useMutation<void, Error, { id: string; reason: string }>({
    mutationFn: async ({ id, reason }) => {
      await apiFetch<null>(`/sales-orders/${id}`, { method: 'DELETE', json: { reason } });
    },
    onSuccess: (_, { id }) => {
      void qc.invalidateQueries({ queryKey: salesOrdersKeys.lists() });
      // ADR-197 — the SO's History tab reads the activity log.
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      qc.removeQueries({ queryKey: salesOrdersKeys.detail(id) });
    },
  });
}
