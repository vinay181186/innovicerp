// Stock Count (ADR-193 phase 2) — TanStack Query hooks.
import type {
  ApproveStockCountInput,
  CreateStockCountInput,
  ListStockCountsQuery,
  ListStockCountsResponse,
  ReplaceStockCountLinesInput,
  ResolveStockCountItemsResponse,
  StockCount,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { activityLogKeys } from '@/modules/activity-log/api';

export const stockCountKeys = {
  all: ['stock-counts'] as const,
  list: (q: ListStockCountsQuery) =>
    [
      ...stockCountKeys.all,
      'list',
      q.status ?? null,
      q.search ?? null,
      q.sf ?? null,
      q.limit,
      q.offset,
    ] as const,
  detail: (id: string) => [...stockCountKeys.all, 'detail', id] as const,
};

export function useStockCounts(q: ListStockCountsQuery) {
  const p = new URLSearchParams();
  if (q.status) p.set('status', q.status);
  if (q.search) p.set('search', q.search);
  if (q.sf) p.set('sf', q.sf);
  p.set('limit', String(q.limit));
  p.set('offset', String(q.offset));
  return useQuery<ListStockCountsResponse>({
    queryKey: stockCountKeys.list(q),
    queryFn: () => apiFetch<ListStockCountsResponse>(`/stock-counts?${p.toString()}`),
    placeholderData: (prev) => prev,
  });
}

export function useStockCount(id: string | undefined) {
  return useQuery<StockCount>({
    queryKey: stockCountKeys.detail(id ?? ''),
    queryFn: () => apiFetch<StockCount>(`/stock-counts/${id}`),
    enabled: Boolean(id),
  });
}

/** Stock moved → every stock screen must re-read. */
function invalidateStock(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: stockCountKeys.all });
  void qc.invalidateQueries({ queryKey: ['store-inventory'] });
  void qc.invalidateQueries({ queryKey: ['store-transactions'] });
  void qc.invalidateQueries({ queryKey: ['items'] });
  void qc.invalidateQueries({ queryKey: activityLogKeys.all });
}

export function useCreateStockCount() {
  const qc = useQueryClient();
  return useMutation<StockCount, Error, CreateStockCountInput>({
    mutationFn: (input) => apiFetch<StockCount>('/stock-counts', { method: 'POST', json: input }),
    onSuccess: () => invalidateStock(qc),
  });
}

export function useReplaceStockCountLines() {
  const qc = useQueryClient();
  return useMutation<StockCount, Error, { id: string } & ReplaceStockCountLinesInput>({
    mutationFn: ({ id, ...body }) =>
      apiFetch<StockCount>(`/stock-counts/${id}/lines`, { method: 'PUT', json: body }),
    onSuccess: () => invalidateStock(qc),
  });
}

export function useStockCountAction(action: 'submit' | 'approve' | 'cancel') {
  const qc = useQueryClient();
  return useMutation<
    StockCount,
    Error,
    { id: string } & Partial<ApproveStockCountInput> & { reason?: string }
  >({
    mutationFn: ({ id, ...body }) =>
      apiFetch<StockCount>(`/stock-counts/${id}/${action}`, { method: 'POST', json: body }),
    onSuccess: () => invalidateStock(qc),
  });
}

export function resolveStockCountItems(codes: string[]): Promise<ResolveStockCountItemsResponse> {
  return apiFetch<ResolveStockCountItemsResponse>('/stock-counts/resolve-items', {
    method: 'POST',
    json: { codes },
  });
}
