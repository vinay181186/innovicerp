import type {
  CreateStoreIssueInput,
  ListStoreIssuesQuery,
  ListStoreIssuesResponse,
  StoreIssue,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const storeIssuesKeys = {
  all: ['store-issues'] as const,
  list: (q: ListStoreIssuesQuery) =>
    [...storeIssuesKeys.all, 'list', q.search ?? null, q.itemId ?? null, q.fromDate ?? null, q.toDate ?? null, q.limit, q.offset] as const,
  nextCode: () => [...storeIssuesKeys.all, 'next-code'] as const,
};

function buildSearch(q: ListStoreIssuesQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.itemId) params.set('itemId', q.itemId);
  if (q.fromDate) params.set('fromDate', q.fromDate);
  if (q.toDate) params.set('toDate', q.toDate);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useStoreIssuesList(query: ListStoreIssuesQuery) {
  return useQuery<ListStoreIssuesResponse>({
    queryKey: storeIssuesKeys.list(query),
    queryFn: () => apiFetch<ListStoreIssuesResponse>(`/store-issues?${buildSearch(query)}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

export function useNextStoreIssueCode() {
  return useQuery<{ code: string }>({
    queryKey: storeIssuesKeys.nextCode(),
    queryFn: () => apiFetch<{ code: string }>('/store-issues/next-code'),
    staleTime: 0,
  });
}

export function useCreateStoreIssue() {
  const qc = useQueryClient();
  return useMutation<StoreIssue, Error, CreateStoreIssueInput>({
    mutationFn: (input) =>
      apiFetch<StoreIssue>('/store-issues', { method: 'POST', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: storeIssuesKeys.all });
      // Item stock changed — invalidate store-inventory + items + store-transactions
      void qc.invalidateQueries({ queryKey: ['store-inventory'] });
      void qc.invalidateQueries({ queryKey: ['store-transactions'] });
      void qc.invalidateQueries({ queryKey: ['items'] });
    },
  });
}
