// ADR-235 — the ONE standard Cancel (Phase A: Invoice, JW Invoice, Customer
// Dispatch). A user with the page's Edit tick sends a Cancel Request with a
// reason; a holder of the Approve tick decides it in Settings → Approvals (or
// presses "Cancel now" to request + approve at once). The server owns every
// rule: who may request / approve, what blocks it, what it will do.
//
// Routes (apps/api cancel-requests):
//   GET  /cancel/:docType/:docId/preview      → CancelPreview
//   POST /cancel/:docType/:docId              → CancelRequestResult
//   POST /cancel-requests/:id/decide          → CancelRequestResult
//   POST /cancel-requests/:id/withdraw        → CancelRequestResult
//   GET  /cancel-requests?status=&toDecide=…  → ListCancelRequestsResponse

import type {
  CancelDocType,
  CancelPreview,
  CancelRequestResult,
  DecideCancelInput,
  ListCancelRequestsQuery,
  ListCancelRequestsResponse,
  RequestCancelInput,
} from '@innovic/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { LIVE_FALLBACK_POLL_MS } from '@/lib/live-updates/constants';
import { activityLogKeys } from '@/modules/activity-log/api';
import { approvalsKeys } from '@/modules/approvals/api';
import { dispatchKeys } from '@/modules/customer-dispatches/api';
import { dashboardKeys } from '@/modules/dashboard/api';
import { invoiceKeys } from '@/modules/invoices/api';
import { jobWorkOrdersKeys } from '@/modules/job-work-orders/api';
import { jwInvoicesKeys } from '@/modules/jw-invoices/api';
import { salesOrdersKeys } from '@/modules/sales-orders/api';
import { storeInventoryKeys } from '@/modules/store-inventory/api';
import { storeTransactionsKeys } from '@/modules/store-transactions/api';

export const cancelKeys = {
  all: ['cancel-requests'] as const,
  previews: () => [...cancelKeys.all, 'preview'] as const,
  preview: (docType: CancelDocType, docId: string) =>
    [...cancelKeys.previews(), docType, docId] as const,
  lists: () => [...cancelKeys.all, 'list'] as const,
  list: (q: ListCancelRequestsQuery) => [...cancelKeys.lists(), q] as const,
};

/** A cancel moves stock, reopens SO / JWSO balances and changes the document's
 *  status — refresh every screen that shows any of it. */
function invalidateAfterCancel(qc: QueryClient): void {
  for (const queryKey of [
    cancelKeys.all,
    invoiceKeys.all,
    jwInvoicesKeys.all,
    dispatchKeys.all,
    salesOrdersKeys.all,
    jobWorkOrdersKeys.all,
    storeInventoryKeys.all,
    storeTransactionsKeys.all,
    approvalsKeys.all,
    dashboardKeys.all,
    activityLogKeys.all,
  ]) {
    void qc.invalidateQueries({ queryKey });
  }
}

/** What Cancel would do to this document right now (or what blocks it, or the
 *  request already open on it). Always re-read on open — never a stale answer. */
export function useCancelPreview(docType: CancelDocType, docId: string, enabled = true) {
  return useQuery<CancelPreview>({
    queryKey: cancelKeys.preview(docType, docId),
    queryFn: () => apiFetch<CancelPreview>(`/cancel/${docType}/${docId}/preview`),
    enabled: enabled && Boolean(docId),
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
  });
}

export function useRequestCancel() {
  const qc = useQueryClient();
  return useMutation<
    CancelRequestResult,
    Error,
    { docType: CancelDocType; docId: string } & RequestCancelInput
  >({
    mutationFn: ({ docType, docId, reason, approveNow }) =>
      apiFetch<CancelRequestResult>(`/cancel/${docType}/${docId}`, {
        method: 'POST',
        json: { reason, approveNow: approveNow ?? false },
      }),
    onSettled: () => invalidateAfterCancel(qc),
  });
}

export function useDecideCancel() {
  const qc = useQueryClient();
  return useMutation<CancelRequestResult, Error, { id: string } & DecideCancelInput>({
    mutationFn: ({ id, decision, note }) =>
      apiFetch<CancelRequestResult>(`/cancel-requests/${id}/decide`, {
        method: 'POST',
        json: note ? { decision, note } : { decision },
      }),
    onSettled: () => invalidateAfterCancel(qc),
  });
}

export function useWithdrawCancel() {
  const qc = useQueryClient();
  return useMutation<CancelRequestResult, Error, { id: string }>({
    mutationFn: ({ id }) =>
      apiFetch<CancelRequestResult>(`/cancel-requests/${id}/withdraw`, { method: 'POST' }),
    onSettled: () => invalidateAfterCancel(qc),
  });
}

/** The Approvals inbox Cancel Requests tab — one page at a time. */
export function useCancelRequests(q: ListCancelRequestsQuery, enabled = true) {
  return useQuery<ListCancelRequestsResponse>({
    queryKey: cancelKeys.list(q),
    queryFn: () => {
      const p = new URLSearchParams();
      if (q.status) p.set('status', q.status);
      if (q.toDecide !== undefined) p.set('toDecide', String(q.toDecide));
      if (q.limit !== undefined) p.set('limit', String(q.limit));
      if (q.offset !== undefined) p.set('offset', String(q.offset));
      return apiFetch<ListCancelRequestsResponse>(`/cancel-requests?${p.toString()}`);
    },
    enabled,
    placeholderData: (prev) => prev,
    refetchInterval: LIVE_FALLBACK_POLL_MS,
  });
}
