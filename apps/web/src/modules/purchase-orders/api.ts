import type {
  CreatePurchaseOrderFromPrInput,
  CreatePurchaseOrderInput,
  ListPurchaseOrdersQuery,
  ListPurchaseOrdersResponse,
  PurchaseOrderDetail,
  UpdatePurchaseOrderInput,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { activityLogKeys } from '@/modules/activity-log/api';
import { purchaseRequestsKeys } from '@/modules/purchase-requests/api';

export const purchaseOrdersKeys = {
  all: ['purchase-orders'] as const,
  lists: () => [...purchaseOrdersKeys.all, 'list'] as const,
  list: (q: ListPurchaseOrdersQuery) => [...purchaseOrdersKeys.lists(), q] as const,
  details: () => [...purchaseOrdersKeys.all, 'detail'] as const,
  detail: (id: string) => [...purchaseOrdersKeys.details(), id] as const,
};

function toQueryString(q: ListPurchaseOrdersQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.status) params.set('status', q.status);
  if (q.poType) params.set('poType', q.poType);
  if (q.vendorId) params.set('vendorId', q.vendorId);
  if (q.fromDate) params.set('fromDate', q.fromDate);
  if (q.toDate) params.set('toDate', q.toDate);
  if (q.jobWorkOrderId) params.set('jobWorkOrderId', q.jobWorkOrderId);
  if (q.sf) params.set('sf', q.sf);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function usePurchaseOrdersList(
  query: ListPurchaseOrdersQuery,
  options?: Omit<UseQueryOptions<ListPurchaseOrdersResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListPurchaseOrdersResponse>({
    queryKey: purchaseOrdersKeys.list(query),
    queryFn: () => apiFetch<ListPurchaseOrdersResponse>(`/purchase-orders?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function usePurchaseOrder(id: string | undefined) {
  return useQuery<PurchaseOrderDetail>({
    queryKey: id ? purchaseOrdersKeys.detail(id) : purchaseOrdersKeys.detail('__missing__'),
    queryFn: () => apiFetch<PurchaseOrderDetail>(`/purchase-orders/${id}`),
    enabled: Boolean(id),
  });
}

export function useUpdatePurchaseOrder(id: string, saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<PurchaseOrderDetail, Error, UpdatePurchaseOrderInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<PurchaseOrderDetail>(`/purchase-orders/${id}`, {
          method: 'PATCH',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: purchaseOrdersKeys.lists() });
      // ADR-197 — the document's History tab reads the activity log.
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      qc.setQueryData(purchaseOrdersKeys.detail(id), updated);
    },
  });
}

export function useSoftDeletePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; reason: string }>({
    mutationFn: async ({ id, reason }) => {
      await apiFetch<null>(`/purchase-orders/${id}`, { method: 'DELETE', json: { reason } });
    },
    onSuccess: (_, { id }) => {
      void qc.invalidateQueries({ queryKey: purchaseOrdersKeys.lists() });
      // ADR-197 — the document's History tab reads the activity log.
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      qc.removeQueries({ queryKey: purchaseOrdersKeys.detail(id) });
    },
  });
}

/** CREATE — `{header, lines}` straight to POST /purchase-orders. This is what
 *  the redesigned PO form posts.
 *
 *  Unlike `useCreatePurchaseOrderFromPr` below, which knows about exactly ONE
 *  PR, a PO created here may cover several — one per line — so EVERY referenced
 *  PR's detail cache is invalidated. Miss one and that PR's page keeps showing
 *  "no PO raised" after the PO exists. */
export function useCreatePurchaseOrder(saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<PurchaseOrderDetail, Error, CreatePurchaseOrderInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<PurchaseOrderDetail>('/purchase-orders', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (created, vars) => {
      void qc.invalidateQueries({ queryKey: purchaseOrdersKeys.lists() });
      // ADR-197 — the document's History tab reads the activity log.
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      qc.setQueryData(purchaseOrdersKeys.detail(created.id), created);
      void qc.invalidateQueries({ queryKey: purchaseRequestsKeys.lists() });
      const prIds = new Set(
        vars.lines.map((l) => l.sourcePrId).filter((x): x is string => Boolean(x)),
      );
      for (const prId of prIds) {
        void qc.invalidateQueries({ queryKey: purchaseRequestsKeys.detail(prId) });
      }
    },
  });
}

/** "Create PO from PR" — also invalidates the PR cache so the linked PO badge
 *  appears immediately on the PR detail page. */
export function useCreatePurchaseOrderFromPr() {
  const qc = useQueryClient();
  return useMutation<PurchaseOrderDetail, Error, CreatePurchaseOrderFromPrInput>({
    mutationFn: (input) =>
      apiFetch<PurchaseOrderDetail>('/purchase-orders/from-pr', {
        method: 'POST',
        json: input,
      }),
    onSuccess: (created, vars) => {
      void qc.invalidateQueries({ queryKey: purchaseOrdersKeys.lists() });
      // ADR-197 — the document's History tab reads the activity log.
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      qc.setQueryData(purchaseOrdersKeys.detail(created.id), created);
      // Refresh the PR detail + list (status flipped to po_created, poId set).
      void qc.invalidateQueries({ queryKey: purchaseRequestsKeys.lists() });
      void qc.invalidateQueries({ queryKey: purchaseRequestsKeys.detail(vars.prId) });
    },
  });
}

export function useApprovePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation<PurchaseOrderDetail, Error, { id: string; remarks?: string }>({
    mutationFn: ({ id, remarks }) =>
      apiFetch<PurchaseOrderDetail>(`/purchase-orders/${id}/approve`, {
        method: 'POST',
        json: remarks ? { remarks } : {},
      }),
    onSuccess: (po) => {
      void qc.invalidateQueries({ queryKey: purchaseOrdersKeys.lists() });
      // ADR-197 — the document's History tab reads the activity log.
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      qc.setQueryData(purchaseOrdersKeys.detail(po.id), po);
    },
  });
}

export function useRejectPurchaseOrder() {
  const qc = useQueryClient();
  return useMutation<PurchaseOrderDetail, Error, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) =>
      apiFetch<PurchaseOrderDetail>(`/purchase-orders/${id}/reject`, {
        method: 'POST',
        json: { reason },
      }),
    onSuccess: (po) => {
      void qc.invalidateQueries({ queryKey: purchaseOrdersKeys.lists() });
      // ADR-197 — the document's History tab reads the activity log.
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      qc.setQueryData(purchaseOrdersKeys.detail(po.id), po);
    },
  });
}

// ADR-189 — stop an issued PO (cancel if nothing moved, else close short).
export function useShortClosePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation<PurchaseOrderDetail, Error, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) =>
      apiFetch<PurchaseOrderDetail>(`/purchase-orders/${id}/short-close`, {
        method: 'POST',
        json: { reason },
      }),
    onSuccess: (po) => {
      void qc.invalidateQueries({ queryKey: purchaseOrdersKeys.lists() });
      // ADR-197 — the document's History tab reads the activity log.
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      qc.setQueryData(purchaseOrdersKeys.detail(po.id), po);
      // Its PRs' Pending changes too.
      void qc.invalidateQueries({ queryKey: ['purchase-requests'] });
    },
  });
}
