import type {
  CreateGoodsReceiptNoteInput,
  DocumentEditStagedResult,
  GoodsReceiptNoteDetail,
  ListGoodsReceiptNotesQuery,
  ListGoodsReceiptNotesResponse,
  UpdateGoodsReceiptNoteInput,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { activityLogKeys } from '@/modules/activity-log/api';
import { purchaseOrdersKeys } from '@/modules/purchase-orders/api';

export const goodsReceiptNotesKeys = {
  all: ['goods-receipt-notes'] as const,
  lists: () => [...goodsReceiptNotesKeys.all, 'list'] as const,
  list: (q: ListGoodsReceiptNotesQuery) => [...goodsReceiptNotesKeys.lists(), q] as const,
  details: () => [...goodsReceiptNotesKeys.all, 'detail'] as const,
  detail: (id: string) => [...goodsReceiptNotesKeys.details(), id] as const,
};

function toQueryString(q: ListGoodsReceiptNotesQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.vendorId) params.set('vendorId', q.vendorId);
  if (q.purchaseOrderId) params.set('purchaseOrderId', q.purchaseOrderId);
  if (q.qcStatus) params.set('qcStatus', q.qcStatus);
  if (q.fromDate) params.set('fromDate', q.fromDate);
  if (q.toDate) params.set('toDate', q.toDate);
  if (q.sf) params.set('sf', q.sf);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useGoodsReceiptNotesList(
  query: ListGoodsReceiptNotesQuery,
  options?: Omit<UseQueryOptions<ListGoodsReceiptNotesResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListGoodsReceiptNotesResponse>({
    queryKey: goodsReceiptNotesKeys.list(query),
    queryFn: () =>
      apiFetch<ListGoodsReceiptNotesResponse>(`/goods-receipt-notes?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useGoodsReceiptNote(id: string | undefined) {
  return useQuery<GoodsReceiptNoteDetail>({
    queryKey: id ? goodsReceiptNotesKeys.detail(id) : goodsReceiptNotesKeys.detail('__missing__'),
    queryFn: () => apiFetch<GoodsReceiptNoteDetail>(`/goods-receipt-notes/${id}`),
    enabled: Boolean(id),
  });
}

/** Re-read ONE GRN from the server, bypassing the cache (ADR-226).
 *
 *  Only used after a save was refused 409 `edit_conflict`: the edit screen needs
 *  the row AS IT IS NOW to work out which fields the other person changed and to
 *  retry onto their version. `staleTime: 0` is the whole point — the cached copy
 *  is the stale photograph we are trying to get past. Mirrors
 *  `useFetchNcRegister` (modules/nc-register/api.ts). */
export function useFetchGoodsReceiptNote(): (id: string) => Promise<GoodsReceiptNoteDetail> {
  const qc = useQueryClient();
  return useCallback(
    (id: string) =>
      qc.fetchQuery<GoodsReceiptNoteDetail>({
        queryKey: goodsReceiptNotesKeys.detail(id),
        queryFn: () => apiFetch<GoodsReceiptNoteDetail>(`/goods-receipt-notes/${id}`),
        staleTime: 0,
      }),
    [qc],
  );
}

/** All GRN write hooks invalidate the PO caches too — every GRN write fans
 *  out cascades to the PO line received_qty + PO header status. */
function invalidatePoCaches(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: purchaseOrdersKeys.all });
  // Every GRN write adds a row to the GRN's (and the PO's) History (ADR-197).
  void qc.invalidateQueries({ queryKey: activityLogKeys.all });
}

export function useCreateGoodsReceiptNote(saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<GoodsReceiptNoteDetail, Error, CreateGoodsReceiptNoteInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<GoodsReceiptNoteDetail>('/goods-receipt-notes', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: goodsReceiptNotesKeys.lists() });
      qc.setQueryData(goodsReceiptNotesKeys.detail(created.id), created);
      invalidatePoCaches(qc);
    },
  });
}

export function useUpdateGoodsReceiptNote(id: string) {
  const qc = useQueryClient();
  // ADR-202 — when the edit-approval gate is on and the GRN is live, the PATCH
  // returns a DocumentEditStagedResult (the edit was staged for approval)
  // instead of the updated GRN. The edit page reads the union to tell them apart.
  return useMutation<
    GoodsReceiptNoteDetail | DocumentEditStagedResult,
    Error,
    UpdateGoodsReceiptNoteInput
  >({
    mutationFn: (input) =>
      apiFetch<GoodsReceiptNoteDetail | DocumentEditStagedResult>(`/goods-receipt-notes/${id}`, {
        method: 'PATCH',
        json: input,
      }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: goodsReceiptNotesKeys.lists() });
      if ('staged' in updated) {
        // Nothing changed on the GRN itself — refresh so the detail page shows
        // the new pending-change chips.
        void qc.invalidateQueries({ queryKey: goodsReceiptNotesKeys.detail(id) });
        void qc.invalidateQueries({ queryKey: ['document-edits'] });
        return;
      }
      qc.setQueryData(goodsReceiptNotesKeys.detail(id), updated);
      invalidatePoCaches(qc);
    },
  });
}

export function useSoftDeleteGoodsReceiptNote() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; reason: string }>({
    // The reason is required by the server (ADR-197) and lands on the GRN's
    // History row for the delete.
    mutationFn: async ({ id, reason }) => {
      await apiFetch<null>(`/goods-receipt-notes/${id}`, {
        method: 'DELETE',
        json: { reason },
      });
    },
    onSuccess: (_, { id }) => {
      void qc.invalidateQueries({ queryKey: goodsReceiptNotesKeys.lists() });
      qc.removeQueries({ queryKey: goodsReceiptNotesKeys.detail(id) });
      invalidatePoCaches(qc);
    },
  });
}
