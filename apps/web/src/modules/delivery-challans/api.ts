import type {
  CreateDeliveryChallanInput,
  CreateDeliveryChallanReceiptInput,
  DcSendablePreview,
  DeliveryChallanWithLines,
  DocumentEditStagedResult,
  ListDeliveryChallansQuery,
  ListDeliveryChallansResponse,
  ListNcRegisterQuery,
  ListNcRegisterResponse,
  ListRtvCandidatesResponse,
  ReceiveDeliveryChallanResponse,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { activityLogKeys } from '@/modules/activity-log/api';
import { isStagedResult } from '@/modules/document-edits/api';
import { ncRegisterKeys } from '@/modules/nc-register/api';

export const deliveryChallansKeys = {
  all: ['delivery-challans'] as const,
  lists: () => [...deliveryChallansKeys.all, 'list'] as const,
  list: (q: ListDeliveryChallansQuery) => [...deliveryChallansKeys.lists(), q] as const,
  details: () => [...deliveryChallansKeys.all, 'detail'] as const,
  detail: (id: string) => [...deliveryChallansKeys.details(), id] as const,
  sendable: (poId: string) => [...deliveryChallansKeys.all, 'sendable', poId] as const,
  /** ADR-208 — every rtv-candidates query (all, or narrowed to one PO). Under
   *  `all`, so useInvalidateNcCascade's deliveryChallansKeys.all invalidation
   *  (fired by a successful create-NC-DC) drops a consumed NC from every list. */
  rtvCandidatesAll: () => [...deliveryChallansKeys.all, 'rtv-candidates'] as const,
  rtvCandidates: (purchaseOrderId: string | null) =>
    [...deliveryChallansKeys.rtvCandidatesAll(), purchaseOrderId ?? '__all__'] as const,
};

function toQueryString(q: ListDeliveryChallansQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.status) params.set('status', q.status);
  if (q.vendorId) params.set('vendorId', q.vendorId);
  if (q.purchaseOrderId) params.set('purchaseOrderId', q.purchaseOrderId);
  if (q.fromDate) params.set('fromDate', q.fromDate);
  if (q.toDate) params.set('toDate', q.toDate);
  if (q.sf) params.set('sf', q.sf);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useDeliveryChallansList(
  query: ListDeliveryChallansQuery,
  options?: Omit<UseQueryOptions<ListDeliveryChallansResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListDeliveryChallansResponse>({
    queryKey: deliveryChallansKeys.list(query),
    queryFn: () =>
      apiFetch<ListDeliveryChallansResponse>(`/delivery-challans?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

/** NCs eligible for a return-to-vendor challan — disposition return_to_vendor,
 *  status disposed, no challan yet (the `pendingRtvChallan` predicate, matching
 *  createNcDc's own guards). Powers the "Against NC" source on +New DC.
 *
 *  Its OWN fetch rather than nc-register's `useNcRegisterList`, on purpose: that
 *  hook's `toQueryString` does not serialise `pendingRtvChallan`, so routing this
 *  through it would silently return the WHOLE NC list (ineligible rows included,
 *  which then fail server-side on submit). nc-register/api.ts is read-only to
 *  this module, so the flag is put on the query string here instead. The query
 *  KEY is deliberately `ncRegisterKeys.list(...)` so `useCreateNcDc`'s
 *  `ncRegisterKeys.lists()` invalidation drops a consumed NC out of this picker. */
export function useEligibleRtvNcs(enabled = true) {
  // limit 200 = the schema cap; masters scroll, they do not paginate.
  const query: ListNcRegisterQuery = { pendingRtvChallan: true, limit: 200, offset: 0 };
  return useQuery<ListNcRegisterResponse>({
    queryKey: ncRegisterKeys.list(query),
    queryFn: () =>
      apiFetch<ListNcRegisterResponse>('/nc-register?pendingRtvChallan=true&limit=200&offset=0'),
    placeholderData: (prev) => prev,
    enabled,
  });
}

/** ADR-208 — return-to-vendor NCs behind a JW PO / its DCs: `ready` (QC
 *  disposed Return to Vendor, no challan yet) and `awaiting_decision` (still
 *  pending QC). Powers the "Against JW PO / DC" picker (no PO → every
 *  candidate, capped server-side) and the Against PO warning (one PO).
 *  `enabled` false skips the fetch — the Against PO form passes it until a PO
 *  is known. Never cached across visits: QC can dispose an NC at any moment. */
export function useRtvCandidates(purchaseOrderId?: string, enabled = true) {
  return useQuery<ListRtvCandidatesResponse>({
    queryKey: deliveryChallansKeys.rtvCandidates(purchaseOrderId ?? null),
    queryFn: () =>
      apiFetch<ListRtvCandidatesResponse>(
        purchaseOrderId
          ? `/delivery-challans/rtv-candidates?purchaseOrderId=${encodeURIComponent(purchaseOrderId)}`
          : '/delivery-challans/rtv-candidates',
      ),
    enabled,
    staleTime: 0,
  });
}

export function useDeliveryChallan(id: string | undefined) {
  return useQuery<DeliveryChallanWithLines>({
    queryKey: id ? deliveryChallansKeys.detail(id) : deliveryChallansKeys.detail('__missing__'),
    queryFn: () => apiFetch<DeliveryChallanWithLines>(`/delivery-challans/${id}`),
    enabled: Boolean(id),
  });
}

/** How many pieces each line of a PO may actually send right now.
 *
 *  The create form asks for this on open so the Send Now box can say what it
 *  will accept while the number is being typed. Without it the form only knew
 *  the PO quantity, happily took a number the shop floor could not support, and
 *  left the refusal to the server after Save.
 *
 *  Never cached across visits (staleTime 0): the answer moves every time an
 *  operation is logged or another challan goes out, and a stale allowance is
 *  worse than none — it would green-light a qty that is no longer there. */
export function useDcSendable(poId: string | undefined) {
  return useQuery<DcSendablePreview>({
    queryKey: deliveryChallansKeys.sendable(poId ?? '__missing__'),
    queryFn: () => apiFetch<DcSendablePreview>(`/delivery-challans/sendable/${poId}`),
    enabled: Boolean(poId),
    staleTime: 0,
  });
}

/** PATCH /delivery-challans/:id payload (ADR-202 Phase 3). Defined here — the
 *  shared contract carries no edit shape for a DC yet; the backend half is being
 *  built in parallel, so this mirrors the natural field names so the frontend
 *  compiles and does a normal update until the staged-edit server lands. Only the
 *  header travel fields (DC Date · Transporter · Vehicle No.) and each existing
 *  LINE's challan qty / Material / DC Remarks are editable; the PO, the vendor and
 *  the set of items cannot change on a saved DC. `reason` rides along for the
 *  activity-log entry (ADR-197); `expectedUpdatedAt` is the optimistic-lock stamp
 *  the DC was loaded with (rule 20.4). All optional string fields are typed
 *  `?: string | undefined` for exactOptionalPropertyTypes. */
export interface UpdateDeliveryChallanInput {
  dcDate?: string | undefined;
  transport?: string | undefined;
  vehicleNo?: string | undefined;
  /** One entry per existing challan line, keyed by delivery_challan_lines.id —
   *  the same id the staged-edit diff uses in its `line:<id>:qty` change key. */
  lines: {
    id: string;
    qty: number;
    materialText?: string | undefined;
    dcRemarks?: string | undefined;
  }[];
  reason?: string | undefined;
  expectedUpdatedAt?: string | undefined;
}

export function useCreateDeliveryChallan(saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<DeliveryChallanWithLines, Error, CreateDeliveryChallanInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<DeliveryChallanWithLines>('/delivery-challans', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: deliveryChallansKeys.lists() });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      qc.setQueryData(deliveryChallansKeys.detail(created.id), created);
    },
  });
}

/**
 * Edit an existing DC (ADR-202 Phase 3). PATCH /delivery-challans/:id returns the
 * updated DC normally, OR a DocumentEditStagedResult when the edit-approval gate
 * is on and this DC is live — then nothing changed and the edit is waiting for
 * approval. Mirrors useUpdateCustomerDispatch: on a staged result refresh the DC
 * detail + ['document-edits'] (so the pending chips appear) and stop; on a normal
 * save invalidate the module's caches as an update would. The History tab reads
 * the activity log either way (ADR-197).
 */
export function useUpdateDeliveryChallan(id: string, saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<
    DeliveryChallanWithLines | DocumentEditStagedResult,
    Error,
    UpdateDeliveryChallanInput
  >({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<DeliveryChallanWithLines | DocumentEditStagedResult>(`/delivery-challans/${id}`, {
          method: 'PATCH',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      if (isStagedResult(updated)) {
        // Nothing changed on the DC itself — refresh so the detail page shows the
        // new pending-change chips.
        void qc.invalidateQueries({ queryKey: deliveryChallansKeys.detail(id) });
        void qc.invalidateQueries({ queryKey: ['document-edits'] });
        return;
      }
      void qc.invalidateQueries({ queryKey: deliveryChallansKeys.lists() });
      qc.setQueryData(deliveryChallansKeys.detail(id), updated);
    },
  });
}

/** Cancel takes a reason (ADR-197) — written on the DC's CANCEL history row. */
export function useCancelDeliveryChallan() {
  const qc = useQueryClient();
  return useMutation<DeliveryChallanWithLines, Error, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) =>
      apiFetch<DeliveryChallanWithLines>(`/delivery-challans/${id}/cancel`, {
        method: 'POST',
        json: { reason },
      }),
    onSuccess: (cancelled) => {
      void qc.invalidateQueries({ queryKey: deliveryChallansKeys.lists() });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      qc.setQueryData(deliveryChallansKeys.detail(cancelled.id), cancelled);
    },
  });
}

// T-059b — receive-back. POST input is the receipt body; URL carries the DC id.
// The response is the refreshed DC plus `autoGrn` — the GRN the receive just
// raised — so the GRN screen's "Against JWPO / DC" tab can land on it. The
// standalone receive page only reads `.id`, which is unchanged.
export function useReceiveDeliveryChallan(saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<
    ReceiveDeliveryChallanResponse,
    Error,
    { dcId: string; input: CreateDeliveryChallanReceiptInput }
  >({
    mutationFn: ({ dcId, input }) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<ReceiveDeliveryChallanResponse>(`/delivery-challans/${dcId}/receive`, {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (received) => {
      void qc.invalidateQueries({ queryKey: deliveryChallansKeys.lists() });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      // Cache the DC shape only; `autoGrn` is a receive-time extra that the
      // detail page never reads and should not linger on its query.
      const { autoGrn: _drop, ...dc } = received;
      void _drop;
      qc.setQueryData(deliveryChallansKeys.detail(received.id), dc);
    },
  });
}
