import type {
  ListTpiQuery,
  TpiCompletedListResponse,
  TpiPendingListResponse,
  TpiResponse,
} from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

// Every key starts with 'tpi', so invalidating `tpiKeys.all` after a TPI or QC
// submit refreshes both paged lists.
export const tpiKeys = {
  all: ['tpi'] as const,
  pending: (q: ListTpiQuery) => ['tpi', 'pending', q] as const,
  completed: (q: ListTpiQuery) => ['tpi', 'completed', q] as const,
};

function qs(q: ListTpiQuery): string {
  const sp = new URLSearchParams({ limit: String(q.limit), offset: String(q.offset) });
  if (q.search) sp.set('search', q.search);
  return `?${sp.toString()}`;
}

/** The whole feed (older callers). */
export function useTpi() {
  return useQuery<TpiResponse>({
    queryKey: tpiKeys.all,
    queryFn: () => apiFetch<TpiResponse>('/tpi'),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}

export function fetchTpiPending(q: ListTpiQuery): Promise<TpiPendingListResponse> {
  return apiFetch<TpiPendingListResponse>(`/tpi/pending${qs(q)}`);
}
export function fetchTpiCompleted(q: ListTpiQuery): Promise<TpiCompletedListResponse> {
  return apiFetch<TpiCompletedListResponse>(`/tpi/completed${qs(q)}`);
}

/** Pending TPI calls — one page (ADR-201). */
export function useTpiPendingList(q: ListTpiQuery) {
  return useQuery<TpiPendingListResponse>({
    queryKey: tpiKeys.pending(q),
    queryFn: () => fetchTpiPending(q),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}

/** Completed TPI records — one page (ADR-201). */
export function useTpiCompletedList(q: ListTpiQuery) {
  return useQuery<TpiCompletedListResponse>({
    queryKey: tpiKeys.completed(q),
    queryFn: () => fetchTpiCompleted(q),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}
