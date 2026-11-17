import type {
  CreatePartyGrnInput,
  DocumentEditStagedResult,
  ListPartyGrnLinesResponse,
  ListPartyGrnQuery,
  ListPartyGrnResponse,
  PartyGrn,
  PartyGrnDetail,
  PartyGrnQcInput,
  SoReceivablePart,
  SoWithCustomerParts,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { relatedDocsKeys } from '@/components/shared/related-docs-tabs';
import { activityLogKeys } from '@/modules/activity-log/api';
import { dashboardKeys } from '@/modules/dashboard/api';
import { incomingQcKeys } from '@/modules/incoming-qc/api';
import { jobWorkOrdersKeys } from '@/modules/job-work-orders/api';
import { assemblyKeys } from '@/modules/assembly/api';
import { qcHistoryKeys } from '@/modules/qc-history/api';
import { salesOrdersKeys } from '@/modules/sales-orders/api';
import { soPlanningKeys } from '@/modules/so-planning/api';
import { soStatusKeys } from '@/modules/so-status/api';

export const partyGrnKeys = {
  all: ['party-grn'] as const,
  list: (q: ListPartyGrnQuery) =>
    [
      ...partyGrnKeys.all,
      'list',
      q.search ?? null,
      q.jobWorkOrderId ?? null,
      q.salesOrderId ?? null,
      q.clientId ?? null,
      q.fromDate ?? null,
      q.toDate ?? null,
      q.sf ?? null,
      q.includeCancelled ?? false,
      q.limit,
      q.offset,
    ] as const,
  /** ADR-261 — the list screen's one-row-per-line read (GET /party-grn/lines). */
  lines: (q: ListPartyGrnQuery) =>
    [
      ...partyGrnKeys.all,
      'lines',
      q.search ?? null,
      q.jobWorkOrderId ?? null,
      q.salesOrderId ?? null,
      q.clientId ?? null,
      q.fromDate ?? null,
      q.toDate ?? null,
      q.sf ?? null,
      q.includeCancelled ?? false,
      q.limit,
      q.offset,
    ] as const,
  detail: (id: string) => [...partyGrnKeys.all, 'detail', id] as const,
  nextCode: () => [...partyGrnKeys.all, 'next-code'] as const,
  waitingQc: (jobWorkOrderId: string) =>
    [...partyGrnKeys.all, 'waiting-qc', jobWorkOrderId] as const,
  /** ADR-307 — open Equipment SOs with customer-supplied BOM parts. */
  receivableSos: () => [...partyGrnKeys.all, 'receivable-sos'] as const,
  /** ADR-307 — one Equipment SO's customer parts with the server's figures. */
  soReceivable: (salesOrderId: string) =>
    [...partyGrnKeys.all, 'so-receivable', salesOrderId] as const,
};

function buildSearch(q: ListPartyGrnQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.jobWorkOrderId) params.set('jobWorkOrderId', q.jobWorkOrderId);
  if (q.salesOrderId) params.set('salesOrderId', q.salesOrderId);
  if (q.clientId) params.set('clientId', q.clientId);
  if (q.fromDate) params.set('fromDate', q.fromDate);
  if (q.toDate) params.set('toDate', q.toDate);
  if (q.sf) params.set('sf', q.sf);
  // ADR-235 — the list screen shows Cancelled GRNs too (other readers do not).
  if (q.includeCancelled) params.set('includeCancelled', 'true');
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

/** ADR-261 — the Party GRN list: one row per GRN line, same params as the list. */
export function usePartyGrnLines(query: ListPartyGrnQuery) {
  return useQuery<ListPartyGrnLinesResponse>({
    queryKey: partyGrnKeys.lines(query),
    queryFn: () => apiFetch<ListPartyGrnLinesResponse>(`/party-grn/lines?${buildSearch(query)}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

/** `poll`: the detail PAGE (ADR-294) refreshes every 60 s like the list
 *  ('party-grn' is 'poll' in REFRESH_POLICY). The Edit / QC popups read the
 *  SAME key, so the page turns `poll` off while one is open. */
export function usePartyGrnDetail(id: string | undefined, opts?: { poll?: boolean }) {
  return useQuery<PartyGrnDetail>({
    queryKey: partyGrnKeys.detail(id ?? '__missing__'),
    queryFn: () => apiFetch<PartyGrnDetail>(`/party-grn/${id}`),
    enabled: Boolean(id),
    ...(opts?.poll ? { refetchInterval: 60_000 } : {}),
  });
}

export function useNextPartyGrnCode() {
  return useQuery<{ code: string }>({
    queryKey: partyGrnKeys.nextCode(),
    queryFn: () => apiFetch<{ code: string }>('/party-grn/next-code'),
    staleTime: 0,
  });
}

/** ADR-307 — the "Against Equipment SO" picker (Party GRN and Customer
 *  Material Return create). Every open Equipment SO whose BOM has a
 *  customer-supplied part; pendingQty 0 = nothing left to receive. */
export function useReceivableSos(enabled = true) {
  return useQuery<SoWithCustomerParts[]>({
    queryKey: partyGrnKeys.receivableSos(),
    queryFn: () => apiFetch<SoWithCustomerParts[]>('/party-grn/receivable-sos'),
    enabled,
    staleTime: 0,
  });
}

/** ADR-307 — the picked Equipment SO's customer parts; figures.pendingQty is
 *  the server's receipt cap (one server function, never recomputed here). */
export function useSoReceivableParts(salesOrderId: string | null | undefined) {
  return useQuery<SoReceivablePart[]>({
    queryKey: partyGrnKeys.soReceivable(salesOrderId ?? '__missing__'),
    queryFn: () =>
      apiFetch<SoReceivablePart[]>(
        `/party-grn/so-receivable?salesOrderId=${encodeURIComponent(salesOrderId ?? '')}`,
      ),
    enabled: Boolean(salesOrderId),
    staleTime: 0,
  });
}

/** ADR-307 — an Equipment SO receipt moves the SO's customer-part figures
 *  (SO parts panel, SO Status, Assembly Tracker). */
function invalidateSoCustomerParts(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: salesOrdersKeys.all });
  void qc.invalidateQueries({ queryKey: soStatusKeys.all });
  void qc.invalidateQueries({ queryKey: assemblyKeys.all });
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
      // OW-143: the JWSO's Customer RM Status moves.
      void qc.invalidateQueries({ queryKey: jobWorkOrdersKeys.all });
      // ADR-279: Planning's Party GRN Status and the home check.
      void qc.invalidateQueries({ queryKey: soPlanningKeys.all });
      void qc.invalidateQueries({ queryKey: dashboardKeys.home() });
      invalidateSoCustomerParts(qc);
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
        // Nothing changed on the GRN itself — refresh so the detail page shows the
        // new pending-change chips.
        void qc.invalidateQueries({ queryKey: partyGrnKeys.detail(id) });
        void qc.invalidateQueries({ queryKey: ['document-edits'] });
        return;
      }
      void qc.invalidateQueries({ queryKey: partyGrnKeys.all });
      // A changed Received Qty moves party-material stocks.
      void qc.invalidateQueries({ queryKey: ['party-materials'] });
      void qc.invalidateQueries({ queryKey: jobWorkOrdersKeys.all });
      // ADR-279: Planning's Party GRN Status and the home check.
      void qc.invalidateQueries({ queryKey: soPlanningKeys.all });
      void qc.invalidateQueries({ queryKey: dashboardKeys.home() });
    },
  });
}

// ADR-235 — Cancel moved to the ONE standard Cancel (cancel-requests module:
// CancelDocDialog, docType 'party_grn'). The old POST /party-grn/:id/cancel
// hook is gone; the dialog uses the generic /cancel routes.

/** ADR-203 (owner D4): Incoming QC on a Party GRN — a separate step after the
 *  receipt, gated by qc_incoming · entry. Part QC (0233): each save books part
 *  of a line's QC Pending. Only the accepted qty enters the customer-material
 *  register. */
export function useQcPartyGrn(saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<PartyGrnDetail, Error, { id: string } & PartyGrnQcInput>({
    // ADR-172: one Idempotency-Key per QC popup — a retry after a timeout
    // replays the first result instead of booking the same pieces twice.
    mutationFn: ({ id, ...body }) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<PartyGrnDetail>(`/party-grn/${id}/qc`, {
          method: 'POST',
          json: body,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: () => {
      // A deviated QC raises an NC — the page's Related Docs lists it (ADR-294).
      void qc.invalidateQueries({ queryKey: relatedDocsKeys.all });
      void qc.invalidateQueries({ queryKey: partyGrnKeys.all });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      // Accepted qty enters the register; JWSO lines show rmAcceptedQty.
      void qc.invalidateQueries({ queryKey: ['party-materials'] });
      void qc.invalidateQueries({ queryKey: ['party-stock-ledger'] });
      void qc.invalidateQueries({ queryKey: jobWorkOrdersKeys.all });
      // ADR-251: the line leaves the Incoming QC / QC Call Register queue and
      // the home dashboard's QC row.
      void qc.invalidateQueries({ queryKey: incomingQcKeys.all });
      void qc.invalidateQueries({ queryKey: qcHistoryKeys.all });
      void qc.invalidateQueries({ queryKey: dashboardKeys.home() });
      // ADR-279: Party GRN Status counts pieces sent back to the customer.
      void qc.invalidateQueries({ queryKey: soPlanningKeys.all });
      // ADR-307: an Equipment SO line's Accepted / Waiting QC moves too.
      invalidateSoCustomerParts(qc);
    },
  });
}
