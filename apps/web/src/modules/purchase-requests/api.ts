import type {
  CreatePurchaseRequestInput,
  DocumentEditStagedResult,
  ListPurchaseRequestsQuery,
  ListPurchaseRequestsResponse,
  PurchaseRequest,
  PurchaseRequestDetail,
  UpdatePurchaseRequestInput,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { activityLogKeys } from '@/modules/activity-log/api';

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
  // Only PRs with quantity still left to order (ADR-152). Sent only when true —
  // an absent param means "no balance filter", which is what every other list
  // on this screen wants.
  if (q.convertibleOnly) params.set('convertibleOnly', 'true');
  // Outsource Jobs tab (ADR-201): its band + JC filter, on the server.
  if (q.orderBand) params.set('orderBand', q.orderBand);
  if (q.sourceJcCode) params.set('sourceJcCode', q.sourceJcCode);
  if (q.fromDate) params.set('fromDate', q.fromDate);
  if (q.toDate) params.set('toDate', q.toDate);
  if (q.sf) params.set('sf', q.sf);
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

export function useCreatePurchaseRequest(saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<PurchaseRequest, Error, CreatePurchaseRequestInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<PurchaseRequest>('/purchase-requests', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: purchaseRequestsKeys.lists() });
      // ADR-197 — the PR's History tab reads the activity log.
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      qc.setQueryData(purchaseRequestsKeys.detail(created.id), created);
    },
  });
}

export function useUpdatePurchaseRequest(id: string, saveKey?: SaveKey) {
  const qc = useQueryClient();
  // ADR-202 — when the edit-approval gate is on and the PR is live, the PATCH
  // returns a DocumentEditStagedResult (the edit was staged for approval)
  // instead of the updated PR. The edit page reads the union to tell them apart.
  return useMutation<PurchaseRequest | DocumentEditStagedResult, Error, UpdatePurchaseRequestInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<PurchaseRequest | DocumentEditStagedResult>(`/purchase-requests/${id}`, {
          method: 'PATCH',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: purchaseRequestsKeys.lists() });
      // ADR-197 — the PR's History tab reads the activity log.
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      if ('staged' in updated) {
        // Nothing changed on the PR itself — just refresh so the detail page
        // shows the new pending-change chips.
        void qc.invalidateQueries({ queryKey: purchaseRequestsKeys.detail(id) });
        void qc.invalidateQueries({ queryKey: ['document-edits'] });
        return;
      }
      qc.setQueryData(purchaseRequestsKeys.detail(id), updated);
    },
  });
}

export function useApprovePr() {
  const qc = useQueryClient();
  return useMutation<PurchaseRequest, Error, string>({
    mutationFn: (id) =>
      apiFetch<PurchaseRequest>(`/purchase-requests/${id}/approve`, { method: 'POST' }),
    onSuccess: (pr) => {
      void qc.invalidateQueries({ queryKey: purchaseRequestsKeys.lists() });
      // ADR-197 — the PR's History tab reads the activity log.
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      qc.setQueryData(purchaseRequestsKeys.detail(pr.id), pr);
    },
  });
}

export function useRejectPr() {
  const qc = useQueryClient();
  return useMutation<PurchaseRequest, Error, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) =>
      apiFetch<PurchaseRequest>(`/purchase-requests/${id}/reject`, {
        method: 'POST',
        json: { reason },
      }),
    onSuccess: (pr) => {
      void qc.invalidateQueries({ queryKey: purchaseRequestsKeys.lists() });
      // ADR-197 — the PR's History tab reads the activity log.
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      qc.setQueryData(purchaseRequestsKeys.detail(pr.id), pr);
    },
  });
}

/** Short-close the unordered remainder (ADR-152 phase 2). The PR keeps its
 *  quantity and everything already ordered; only the balance is abandoned, with
 *  a reason that is required. Same invalidation as approve / reject — the list
 *  rows carry the balance too, so both caches have to move together. */
export function useClosePurchaseRequestBalance() {
  const qc = useQueryClient();
  return useMutation<PurchaseRequest, Error, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) =>
      apiFetch<PurchaseRequest>(`/purchase-requests/${id}/close-balance`, {
        method: 'POST',
        json: { reason },
      }),
    onSuccess: (pr) => {
      void qc.invalidateQueries({ queryKey: purchaseRequestsKeys.lists() });
      // ADR-197 — the PR's History tab reads the activity log.
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      // The detail read carries joins (vendor name, PO code) the write-back
      // shape does not, so refetch it rather than overwriting the cache with a
      // narrower row — the same reason the page must show the closed banner
      // straight after the mutation.
      void qc.invalidateQueries({ queryKey: purchaseRequestsKeys.detail(pr.id) });
    },
  });
}

export function useSoftDeletePurchaseRequest() {
  const qc = useQueryClient();
  // ADR-197 — a reason is required to move a PR to Trash.
  return useMutation<void, Error, { id: string; reason: string }>({
    mutationFn: async ({ id, reason }) => {
      await apiFetch<null>(`/purchase-requests/${id}`, { method: 'DELETE', json: { reason } });
    },
    onSuccess: (_, { id }) => {
      void qc.invalidateQueries({ queryKey: purchaseRequestsKeys.lists() });
      // ADR-197 — the PR's History tab reads the activity log.
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      qc.removeQueries({ queryKey: purchaseRequestsKeys.detail(id) });
    },
  });
}
