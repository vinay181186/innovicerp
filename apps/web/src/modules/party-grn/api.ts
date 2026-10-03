import type {
  CreatePartyGrnInput,
  DocumentEditStagedResult,
  ListPartyGrnQuery,
  ListPartyGrnResponse,
  PartyGrn,
  PartyGrnDetail,
  PartyGrnQcInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { activityLogKeys } from '@/modules/activity-log/api';

export const partyGrnKeys = {
  all: ['party-grn'] as const,
  list: (q: ListPartyGrnQuery) =>
    [
      ...partyGrnKeys.all,
      'list',
      q.search ?? null,
      q.jobWorkOrderId ?? null,
      q.clientId ?? null,
      q.fromDate ?? null,
      q.toDate ?? null,
      q.sf ?? null,
      q.limit,
      q.offset,
    ] as const,
  detail: (id: string) => [...partyGrnKeys.all, 'detail', id] as const,
  nextCode: () => [...partyGrnKeys.all, 'next-code'] as const,
  waitingQc: (jobWorkOrderId: string) =>
    [...partyGrnKeys.all, 'waiting-qc', jobWorkOrderId] as const,
};

function buildSearch(q: ListPartyGrnQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.jobWorkOrderId) params.set('jobWorkOrderId', q.jobWorkOrderId);
  if (q.clientId) params.set('clientId', q.clientId);
  if (q.fromDate) params.set('fromDate', q.fromDate);
  if (q.toDate) params.set('toDate', q.toDate);
  if (q.sf) params.set('sf', q.sf);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function usePartyGrnList(query: ListPartyGrnQuery) {
  return useQuery<ListPartyGrnResponse>({
    queryKey: partyGrnKeys.list(query),
    queryFn: () => apiFetch<ListPartyGrnResponse>(`/party-grn?${buildSearch(query)}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

export function usePartyGrnDetail(id: string | undefined) {
  return useQuery<PartyGrnDetail>({
    queryKey: partyGrnKeys.detail(id ?? '__missing__'),
    queryFn: () => apiFetch<PartyGrnDetail>(`/party-grn/${id}`),
    enabled: Boolean(id),
  });
}

export function useNextPartyGrnCode() {
  return useQuery<{ code: string }>({
    queryKey: partyGrnKeys.nextCode(),
    queryFn: () => apiFetch<{ code: string }>('/party-grn/next-code'),
    staleTime: 0,
  });
}

export function useCreatePartyGrn(saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<PartyGrn, Error, CreatePartyGrnInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<PartyGrn>('/party-grn', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: partyGrnKeys.all });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      // Party material stocks changed
      void qc.invalidateQueries({ queryKey: ['party-materials'] });
    },
  });
}

/** PATCH /party-grn/:id payload (ADR-202 Phase 3). Defined here, not yet in the
 *  shared contract — the backend half is being built in parallel; this mirrors
 *  the natural field names so the frontend compiles and works a normal update
 *  until the staged-edit server lands. Only the header travel fields and, per
 *  line still waiting for Incoming QC, its Received Qty + line remarks are
 *  editable; the JWSO and the set of lines cannot change on an existing receipt.
 *  `reason` rides along for the activity-log entry (ADR-197); `expectedUpdatedAt`
 *  is the detail's updatedAt for the server's §20.4 concurrency check. */
export interface UpdatePartyGrnInput {
  grnDate?: string | undefined;
  dcNo?: string | undefined;
  remarks?: string | undefined;
  receivedBy?: string | undefined;
  /** One entry per existing line, keyed by party_grn_lines.id — the same id the
   *  staged-edit diff uses in its `line:<id>:qty` / `line:<id>:remarks` keys. */
  lines: { id: string; receivedQty?: number | undefined; remarks?: string | undefined }[];
  reason?: string | undefined;
  expectedUpdatedAt?: string | undefined;
}

/**
 * Edit an existing Party GRN (ADR-202 Phase 3). PATCH /party-grn/:id returns the
 * updated detail normally, OR a DocumentEditStagedResult when the edit-approval
 * gate is on and this receipt is live — then nothing changed and the edit is
 * waiting for approval. Mirrors useUpdateCustomerDispatch: on a staged result
 * refresh the detail + ['document-edits'] (so the pending chips appear) and stop;
 * on a normal save invalidate the module lists as an update would.
 */
export function useUpdatePartyGrn(id: string, saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<PartyGrnDetail | DocumentEditStagedResult, Error, UpdatePartyGrnInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<PartyGrnDetail | DocumentEditStagedResult>(`/party-grn/${id}`, {
          method: 'PATCH',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (updated) => {
      // ADR-197 — the receipt's History reads the activity log either way.
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      if ('staged' in updated) {
        // Nothing changed on the GRN itself — refresh so the expand shows the
        // new pending-change chips.
        void qc.invalidateQueries({ queryKey: partyGrnKeys.detail(id) });
        void qc.invalidateQueries({ queryKey: ['document-edits'] });
        return;
      }
      void qc.invalidateQueries({ queryKey: partyGrnKeys.all });
      // A changed Received Qty moves party-material stocks.
      void qc.invalidateQueries({ queryKey: ['party-materials'] });
    },
  });
}

/** ADR-102 — reverse a wrong receipt. Credits the qty back off party stock. */
export function useCancelPartyGrn() {
  const qc = useQueryClient();
  return useMutation<
    { ok: true; code: string; reversedQty: number },
    Error,
    { id: string; reason: string }
  >({
    mutationFn: ({ id, reason }) =>
      apiFetch<{ ok: true; code: string; reversedQty: number }>(`/party-grn/${id}/cancel`, {
        method: 'POST',
        json: { reason },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: partyGrnKeys.all });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      void qc.invalidateQueries({ queryKey: ['party-materials'] });
    },
  });
}

/** ADR-203 (owner D4): Incoming QC on a Party GRN — a separate step after the
 *  receipt, gated by qc_incoming · entry. Only the accepted qty enters the
 *  customer-material register. */
export function useQcPartyGrn() {
  const qc = useQueryClient();
  return useMutation<PartyGrnDetail, Error, { id: string } & PartyGrnQcInput>({
    mutationFn: ({ id, ...body }) =>
      apiFetch<PartyGrnDetail>(`/party-grn/${id}/qc`, { method: 'POST', json: body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: partyGrnKeys.all });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      // Accepted qty enters the register; JWSO lines show rmAcceptedQty.
      void qc.invalidateQueries({ queryKey: ['party-materials'] });
      void qc.invalidateQueries({ queryKey: ['party-stock-ledger'] });
      void qc.invalidateQueries({ queryKey: ['job-work-orders'] });
    },
  });
}
