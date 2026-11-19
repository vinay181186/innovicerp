// Customer Material Return (ADR-203, owner decision D3) — the numbered challan
// (IN-CMR-#####) that sends the customer's OWN raw material back: spare good
// material from the register, and pieces Incoming QC rejected on a Party GRN.
// Mirrors party-grn/api.ts: one key family, list / detail / returnable reads,
// create (idempotency key). Cancel is the standard Cancel (ADR-235).

import type {
  CreateCustomerMaterialReturnInput,
  CustomerMaterialReturn,
  CustomerMaterialReturnDetail,
  CustomerMaterialReturnableRow,
  ListCustomerMaterialReturnLinesResponse,
  ListCustomerMaterialReturnsQuery,
  ListCustomerMaterialReturnsResponse,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { activityLogKeys } from '@/modules/activity-log/api';
import { assemblyKeys } from '@/modules/assembly/api';
import { jobWorkOrdersKeys } from '@/modules/job-work-orders/api';
import { partyGrnKeys } from '@/modules/party-grn/api';
import { salesOrdersKeys } from '@/modules/sales-orders/api';
import { soStatusKeys } from '@/modules/so-status/api';

export const customerMaterialReturnKeys = {
  all: ['customer-material-returns'] as const,
  list: (q: ListCustomerMaterialReturnsQuery) =>
    [
      ...customerMaterialReturnKeys.all,
      'list',
      q.search ?? null,
      q.jobWorkOrderId ?? null,
      q.sf ?? null,
      q.limit,
      q.offset,
    ] as const,
  /** ADR-261 — the register as one row per return line. */
  lines: (q: ListCustomerMaterialReturnsQuery) =>
    [
      ...customerMaterialReturnKeys.all,
      'lines',
      q.search ?? null,
      q.jobWorkOrderId ?? null,
      q.sf ?? null,
      q.limit,
      q.offset,
    ] as const,
  detail: (id: string) => [...customerMaterialReturnKeys.all, 'detail', id] as const,
  /** ADR-307 — against a JWSO ('jwso') or an Equipment SO ('so'). */
  returnable: (against: CmrAgainst, orderId: string) =>
    [...customerMaterialReturnKeys.all, 'returnable', against, orderId] as const,
};

/** ADR-307 — which order a return is raised against. */
export type CmrAgainst = 'jwso' | 'so';

function buildSearch(q: ListCustomerMaterialReturnsQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.jobWorkOrderId) params.set('jobWorkOrderId', q.jobWorkOrderId);
  if (q.salesOrderId) params.set('salesOrderId', q.salesOrderId);
  if (q.sf) params.set('sf', q.sf);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useCustomerMaterialReturnsList(query: ListCustomerMaterialReturnsQuery) {
  return useQuery<ListCustomerMaterialReturnsResponse>({
    queryKey: customerMaterialReturnKeys.list(query),
    queryFn: () => fetchCustomerMaterialReturnsPage(query),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

/** ADR-261 — GET /customer-material-returns/lines: one row per return line. */
export function useCustomerMaterialReturnLines(query: ListCustomerMaterialReturnsQuery) {
  return useQuery<ListCustomerMaterialReturnLinesResponse>({
    queryKey: customerMaterialReturnKeys.lines(query),
    queryFn: () => fetchCustomerMaterialReturnLinesPage(query),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

export function useCustomerMaterialReturn(id: string | undefined) {
  return useQuery<CustomerMaterialReturnDetail>({
    queryKey: customerMaterialReturnKeys.detail(id ?? '__missing__'),
    queryFn: () => apiFetch<CustomerMaterialReturnDetail>(`/customer-material-returns/${id}`),
    enabled: Boolean(id),
  });
}

/** What can still go back for one JWSO — or (ADR-307) one Equipment SO —
 *  the SAME caps the server enforces. */
export function useCustomerMaterialReturnable(
  against: CmrAgainst,
  orderId: string | null | undefined,
) {
  const param = against === 'so' ? 'salesOrderId' : 'jobWorkOrderId';
  return useQuery<CustomerMaterialReturnableRow[]>({
    queryKey: customerMaterialReturnKeys.returnable(against, orderId ?? '__missing__'),
    queryFn: () =>
      apiFetch<CustomerMaterialReturnableRow[]>(
        `/customer-material-returns/returnable?${param}=${encodeURIComponent(orderId ?? '')}`,
      ),
    enabled: Boolean(orderId),
    staleTime: 0,
  });
}

function invalidateAfterWrite(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: customerMaterialReturnKeys.all });
  void qc.invalidateQueries({ queryKey: activityLogKeys.all });
  // Register balances, Party GRN rejected-returned figures and the ledger move.
  void qc.invalidateQueries({ queryKey: ['party-materials'] });
  void qc.invalidateQueries({ queryKey: partyGrnKeys.all });
  void qc.invalidateQueries({ queryKey: ['party-stock-ledger'] });
  void qc.invalidateQueries({ queryKey: jobWorkOrdersKeys.all });
  // ADR-307: an Equipment SO's customer-part Returned / In Store figures.
  void qc.invalidateQueries({ queryKey: salesOrdersKeys.all });
  void qc.invalidateQueries({ queryKey: soStatusKeys.all });
  void qc.invalidateQueries({ queryKey: assemblyKeys.all });
}

export function useCreateCustomerMaterialReturn(saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<CustomerMaterialReturn, Error, CreateCustomerMaterialReturnInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<CustomerMaterialReturn>('/customer-material-returns', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: () => invalidateAfterWrite(qc),
  });
}

// ADR-235 — Cancel moved to the ONE standard Cancel (cancel-requests module:
// CancelDocDialog, docType 'customer_material_return'). The old POST
// /customer-material-returns/:id/cancel hook is gone.

/** ADR-310 — one page of GET /customer-material-returns: the list hook and the shared Export
 *  both read it. */
export function fetchCustomerMaterialReturnsPage(
  query: ListCustomerMaterialReturnsQuery,
): Promise<ListCustomerMaterialReturnsResponse> {
  return apiFetch<ListCustomerMaterialReturnsResponse>(
    `/customer-material-returns?${buildSearch(query)}`,
  );
}

/** ADR-310 — one page of GET /customer-material-returns/lines: the list hook and the shared Export
 *  both read it. */
export function fetchCustomerMaterialReturnLinesPage(
  query: ListCustomerMaterialReturnsQuery,
): Promise<ListCustomerMaterialReturnLinesResponse> {
  return apiFetch<ListCustomerMaterialReturnLinesResponse>(
    `/customer-material-returns/lines?${buildSearch(query)}`,
  );
}
