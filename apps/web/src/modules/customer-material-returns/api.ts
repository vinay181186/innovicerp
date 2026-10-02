// Customer Material Return (ADR-203, owner decision D3) — the numbered challan
// (IN-CMR-#####) that sends the customer's OWN raw material back: spare good
// material from the register, and pieces Incoming QC rejected on a Party GRN.
// Mirrors party-grn/api.ts: one key family, list / detail / returnable reads,
// create (idempotency key) and cancel (reason).

import type {
  CancelCustomerMaterialReturnInput,
  CreateCustomerMaterialReturnInput,
  CustomerMaterialReturn,
  CustomerMaterialReturnDetail,
  CustomerMaterialReturnableRow,
  ListCustomerMaterialReturnsQuery,
  ListCustomerMaterialReturnsResponse,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { activityLogKeys } from '@/modules/activity-log/api';

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
  detail: (id: string) => [...customerMaterialReturnKeys.all, 'detail', id] as const,
  returnable: (jobWorkOrderId: string) =>
    [...customerMaterialReturnKeys.all, 'returnable', jobWorkOrderId] as const,
};

function buildSearch(q: ListCustomerMaterialReturnsQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.jobWorkOrderId) params.set('jobWorkOrderId', q.jobWorkOrderId);
  if (q.sf) params.set('sf', q.sf);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useCustomerMaterialReturnsList(query: ListCustomerMaterialReturnsQuery) {
  return useQuery<ListCustomerMaterialReturnsResponse>({
    queryKey: customerMaterialReturnKeys.list(query),
    queryFn: () =>
      apiFetch<ListCustomerMaterialReturnsResponse>(
        `/customer-material-returns?${buildSearch(query)}`,
      ),
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

/** What can still go back for one JWSO — the SAME caps the server enforces. */
export function useCustomerMaterialReturnable(jobWorkOrderId: string | undefined) {
  return useQuery<CustomerMaterialReturnableRow[]>({
    queryKey: customerMaterialReturnKeys.returnable(jobWorkOrderId ?? '__missing__'),
    queryFn: () =>
      apiFetch<CustomerMaterialReturnableRow[]>(
        `/customer-material-returns/returnable?jobWorkOrderId=${encodeURIComponent(
          jobWorkOrderId ?? '',
        )}`,
      ),
    enabled: Boolean(jobWorkOrderId),
    staleTime: 0,
  });
}

function invalidateAfterWrite(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: customerMaterialReturnKeys.all });
  void qc.invalidateQueries({ queryKey: activityLogKeys.all });
  // Register balances, Party GRN rejected-returned figures and the ledger move.
  void qc.invalidateQueries({ queryKey: ['party-materials'] });
  void qc.invalidateQueries({ queryKey: ['party-grn'] });
  void qc.invalidateQueries({ queryKey: ['party-stock-ledger'] });
  void qc.invalidateQueries({ queryKey: ['job-work-orders'] });
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

export function useCancelCustomerMaterialReturn() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { id: string } & CancelCustomerMaterialReturnInput>({
    mutationFn: ({ id, reason }) =>
      apiFetch<unknown>(`/customer-material-returns/${id}/cancel`, {
        method: 'POST',
        json: { reason },
      }),
    onSuccess: () => invalidateAfterWrite(qc),
  });
}
