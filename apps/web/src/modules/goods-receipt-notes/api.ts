import type {
  CreateGoodsReceiptNoteInput,
  GoodsReceiptNoteDetail,
  ListGoodsReceiptNotesQuery,
  ListGoodsReceiptNotesResponse,
  UpdateGoodsReceiptNoteInput,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
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

/** All GRN write hooks invalidate the PO caches too — every GRN write fans
 *  out cascades to the PO line received_qty + PO header status. */
function invalidatePoCaches(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: purchaseOrdersKeys.all });
}

export function useCreateGoodsReceiptNote() {
  const qc = useQueryClient();
  return useMutation<GoodsReceiptNoteDetail, Error, CreateGoodsReceiptNoteInput>({
    mutationFn: (input) =>
      apiFetch<GoodsReceiptNoteDetail>('/goods-receipt-notes', { method: 'POST', json: input }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: goodsReceiptNotesKeys.lists() });
      qc.setQueryData(goodsReceiptNotesKeys.detail(created.id), created);
      invalidatePoCaches(qc);
    },
  });
}

export function useUpdateGoodsReceiptNote(id: string) {
  const qc = useQueryClient();
  return useMutation<GoodsReceiptNoteDetail, Error, UpdateGoodsReceiptNoteInput>({
    mutationFn: (input) =>
      apiFetch<GoodsReceiptNoteDetail>(`/goods-receipt-notes/${id}`, {
        method: 'PATCH',
        json: input,
      }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: goodsReceiptNotesKeys.lists() });
      qc.setQueryData(goodsReceiptNotesKeys.detail(id), updated);
      invalidatePoCaches(qc);
    },
  });
}

export function useSoftDeleteGoodsReceiptNote() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await apiFetch<null>(`/goods-receipt-notes/${id}`, { method: 'DELETE' });
    },
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: goodsReceiptNotesKeys.lists() });
      qc.removeQueries({ queryKey: goodsReceiptNotesKeys.detail(id) });
      invalidatePoCaches(qc);
    },
  });
}
