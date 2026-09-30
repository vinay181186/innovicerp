// Item Issue (ADR-193 phase 3b) — TanStack Query hooks. A slip has lines; it is
// issued against a Job Card, an Assembly SO or for general use.
import type {
  CreateStoreIssueInput,
  ListStoreIssuesQuery,
  ListStoreIssuesResponse,
  ReturnStoreIssueInput,
  ReverseStoreIssueInput,
  StoreIssueDetail,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { activityLogKeys } from '@/modules/activity-log/api';

export const storeIssuesKeys = {
  all: ['store-issues'] as const,
  list: (q: ListStoreIssuesQuery) =>
    [
      ...storeIssuesKeys.all,
      'list',
      q.search ?? null,
      q.itemId ?? null,
      q.jobCardId ?? null,
      q.salesOrderId ?? null,
      q.fromDate ?? null,
      q.toDate ?? null,
      q.limit,
      q.offset,
    ] as const,
  detail: (id: string) => [...storeIssuesKeys.all, 'detail', id] as const,
};

function buildSearch(q: ListStoreIssuesQuery): string {
  const p = new URLSearchParams();
  if (q.search) p.set('search', q.search);
  if (q.itemId) p.set('itemId', q.itemId);
  if (q.jobCardId) p.set('jobCardId', q.jobCardId);
  if (q.salesOrderId) p.set('salesOrderId', q.salesOrderId);
  if (q.fromDate) p.set('fromDate', q.fromDate);
  if (q.toDate) p.set('toDate', q.toDate);
  p.set('limit', String(q.limit));
  p.set('offset', String(q.offset));
  return p.toString();
}

export function useStoreIssuesList(query: ListStoreIssuesQuery) {
  return useQuery<ListStoreIssuesResponse>({
    queryKey: storeIssuesKeys.list(query),
    queryFn: () => apiFetch<ListStoreIssuesResponse>(`/store-issues?${buildSearch(query)}`),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useStoreIssue(id: string | null) {
  return useQuery<StoreIssueDetail>({
    queryKey: storeIssuesKeys.detail(id ?? ''),
    queryFn: () => apiFetch<StoreIssueDetail>(`/store-issues/${id}`),
    enabled: Boolean(id),
  });
}

/** Stock moved → issue lists, material views and stock screens re-read. */
function invalidate(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: storeIssuesKeys.all });
  void qc.invalidateQueries({ queryKey: ['material'] });
  void qc.invalidateQueries({ queryKey: ['store-inventory'] });
  void qc.invalidateQueries({ queryKey: ['store-transactions'] });
  void qc.invalidateQueries({ queryKey: ['items'] });
  void qc.invalidateQueries({ queryKey: activityLogKeys.all });
}

export function useCreateStoreIssue(saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<StoreIssueDetail, Error, CreateStoreIssueInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<StoreIssueDetail>('/store-issues', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: () => invalidate(qc),
  });
}

export function useReturnStoreIssue() {
  const qc = useQueryClient();
  return useMutation<StoreIssueDetail, Error, { id: string } & ReturnStoreIssueInput>({
    mutationFn: ({ id, ...body }) =>
      apiFetch<StoreIssueDetail>(`/store-issues/${id}/returns`, { method: 'POST', json: body }),
    onSuccess: () => invalidate(qc),
  });
}

export function useReverseStoreIssue() {
  const qc = useQueryClient();
  return useMutation<StoreIssueDetail, Error, { id: string } & ReverseStoreIssueInput>({
    mutationFn: ({ id, reason }) =>
      apiFetch<StoreIssueDetail>(`/store-issues/${id}/reverse`, {
        method: 'POST',
        json: { reason },
      }),
    onSuccess: () => invalidate(qc),
  });
}
