import type {
  CreatePurchaseRequestInput,
  ListPurchaseRequestsQuery,
  ListPurchaseRequestsResponse,
  PurchaseRequest,
  PurchaseRequestDetail,
  UpdatePurchaseRequestInput,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const purchaseRequestsKeys = {
  all: ['purchase-requests'] as const,
  lists: () => [...purchaseRequestsKeys.all, 'list'] as const,
  list: (q: ListPurchaseRequestsQuery) => [...purchaseRequestsKeys.lists(), q] as const,
  details: () => [...purchaseRequestsKeys.all, 'detail'] as const,
  detail: (id: string) => [...purchaseRequestsKeys.details(), id] as const,
};

function toQueryString(q: ListPurchaseRequestsQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.status) params.set('status', q.status);
  if (q.prType) params.set('prType', q.prType);
  if (q.vendorId) params.set('vendorId', q.vendorId);
  if (q.sourceJcOpId) params.set('sourceJcOpId', q.sourceJcOpId);
  if (q.fromDate) params.set('fromDate', q.fromDate);
  if (q.toDate) params.set('toDate', q.toDate);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function usePurchaseRequestsList(
  query: ListPurchaseRequestsQuery,
  options?: Omit<UseQueryOptions<ListPurchaseRequestsResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListPurchaseRequestsResponse>({
    queryKey: purchaseRequestsKeys.list(query),
    queryFn: () =>
      apiFetch<ListPurchaseRequestsResponse>(`/purchase-requests?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function usePurchaseRequest(id: string | undefined) {
  return useQuery<PurchaseRequestDetail>({
    queryKey: id ? purchaseRequestsKeys.detail(id) : purchaseRequestsKeys.detail('__missing__'),
    queryFn: () => apiFetch<PurchaseRequestDetail>(`/purchase-requests/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreatePurchaseRequest() {
  const qc = useQueryClient();
  return useMutation<PurchaseRequest, Error, CreatePurchaseRequestInput>({
    mutationFn: (input) =>
      apiFetch<PurchaseRequest>('/purchase-requests', { method: 'POST', json: input }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: purchaseRequestsKeys.lists() });
      qc.setQueryData(purchaseRequestsKeys.detail(created.id), created);
    },
  });
}

export function useUpdatePurchaseRequest(id: string) {
  const qc = useQueryClient();
  return useMutation<PurchaseRequest, Error, UpdatePurchaseRequestInput>({
    mutationFn: (input) =>
      apiFetch<PurchaseRequest>(`/purchase-requests/${id}`, { method: 'PATCH', json: input }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: purchaseRequestsKeys.lists() });
      qc.setQueryData(purchaseRequestsKeys.detail(id), updated);
    },
  });
}

export function useSoftDeletePurchaseRequest() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await apiFetch<null>(`/purchase-requests/${id}`, { method: 'DELETE' });
    },
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: purchaseRequestsKeys.lists() });
      qc.removeQueries({ queryKey: purchaseRequestsKeys.detail(id) });
    },
  });
}
