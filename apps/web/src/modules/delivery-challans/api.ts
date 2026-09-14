import type {
  CreateDeliveryChallanInput,
  CreateDeliveryChallanReceiptInput,
  DcSendablePreview,
  DeliveryChallanWithLines,
  ListDeliveryChallansQuery,
  ListDeliveryChallansResponse,
  ListNcRegisterQuery,
  ListNcRegisterResponse,
  ReceiveDeliveryChallanResponse,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { ncRegisterKeys } from '@/modules/nc-register/api';

export const deliveryChallansKeys = {
  all: ['delivery-challans'] as const,
  lists: () => [...deliveryChallansKeys.all, 'list'] as const,
  list: (q: ListDeliveryChallansQuery) => [...deliveryChallansKeys.lists(), q] as const,
  details: () => [...deliveryChallansKeys.all, 'detail'] as const,
  detail: (id: string) => [...deliveryChallansKeys.details(), id] as const,
  sendable: (poId: string) => [...deliveryChallansKeys.all, 'sendable', poId] as const,
};

function toQueryString(q: ListDeliveryChallansQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.status) params.set('status', q.status);
  if (q.vendorId) params.set('vendorId', q.vendorId);
  if (q.purchaseOrderId) params.set('purchaseOrderId', q.purchaseOrderId);
  if (q.fromDate) params.set('fromDate', q.fromDate);
  if (q.toDate) params.set('toDate', q.toDate);
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

export function useCreateDeliveryChallan() {
  const qc = useQueryClient();
  return useMutation<DeliveryChallanWithLines, Error, CreateDeliveryChallanInput>({
    mutationFn: (input) =>
      apiFetch<DeliveryChallanWithLines>('/delivery-challans', { method: 'POST', json: input }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: deliveryChallansKeys.lists() });
      qc.setQueryData(deliveryChallansKeys.detail(created.id), created);
    },
  });
}

export function useCancelDeliveryChallan() {
  const qc = useQueryClient();
  return useMutation<DeliveryChallanWithLines, Error, string>({
    mutationFn: (id) =>
      apiFetch<DeliveryChallanWithLines>(`/delivery-challans/${id}/cancel`, { method: 'POST' }),
    onSuccess: (cancelled) => {
      void qc.invalidateQueries({ queryKey: deliveryChallansKeys.lists() });
      qc.setQueryData(deliveryChallansKeys.detail(cancelled.id), cancelled);
    },
  });
}

// T-059b — receive-back. POST input is the receipt body; URL carries the DC id.
// The response is the refreshed DC plus `autoGrn` — the GRN the receive just
// raised — so the GRN screen's "Against JWPO / DC" tab can land on it. The
// standalone receive page only reads `.id`, which is unchanged.
export function useReceiveDeliveryChallan() {
  const qc = useQueryClient();
  return useMutation<
    ReceiveDeliveryChallanResponse,
    Error,
    { dcId: string; input: CreateDeliveryChallanReceiptInput }
  >({
    mutationFn: ({ dcId, input }) =>
      apiFetch<ReceiveDeliveryChallanResponse>(`/delivery-challans/${dcId}/receive`, {
        method: 'POST',
        json: input,
      }),
    onSuccess: (received) => {
      void qc.invalidateQueries({ queryKey: deliveryChallansKeys.lists() });
      // Cache the DC shape only; `autoGrn` is a receive-time extra that the
      // detail page never reads and should not linger on its query.
      const { autoGrn: _drop, ...dc } = received;
      void _drop;
      qc.setQueryData(deliveryChallansKeys.detail(received.id), dc);
    },
  });
}
