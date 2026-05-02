import type {
  CreatePurchaseOrderFromPrInput,
  CreatePurchaseOrderInput,
  ListPurchaseOrdersQuery,
  ListPurchaseOrdersResponse,
  PurchaseOrderDetail,
  UpdatePurchaseOrderInput,
} from '@innovic/shared';
import {
  type UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
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
    queryFn: () =>
      apiFetch<ListPurchaseOrdersResponse>(`/purchase-orders?${toQueryString(query)}`),
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

export function useCreatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation<PurchaseOrderDetail, Error, CreatePurchaseOrderInput>({
    mutationFn: (input) =>
      apiFetch<PurchaseOrderDetail>('/purchase-orders', { method: 'POST', json: input }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: purchaseOrdersKeys.lists() });
      qc.setQueryData(purchaseOrdersKeys.detail(created.id), created);
    },
  });
}

export function useUpdatePurchaseOrder(id: string) {
  const qc = useQueryClient();
  return useMutation<PurchaseOrderDetail, Error, UpdatePurchaseOrderInput>({
    mutationFn: (input) =>
      apiFetch<PurchaseOrderDetail>(`/purchase-orders/${id}`, { method: 'PATCH', json: input }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: purchaseOrdersKeys.lists() });
      qc.setQueryData(purchaseOrdersKeys.detail(id), updated);
    },
  });
}

export function useSoftDeletePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await apiFetch<null>(`/purchase-orders/${id}`, { method: 'DELETE' });
    },
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: purchaseOrdersKeys.lists() });
      qc.removeQueries({ queryKey: purchaseOrdersKeys.detail(id) });
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
      qc.setQueryData(purchaseOrdersKeys.detail(created.id), created);
      // Refresh the PR detail + list (status flipped to po_created, poId set).
      void qc.invalidateQueries({ queryKey: purchaseRequestsKeys.lists() });
      void qc.invalidateQueries({ queryKey: purchaseRequestsKeys.detail(vars.prId) });
    },
  });
}
