import type {
  JobCardListItem,
  ListJobCardsQuery,
  ListJobCardsResponse,
} from '@innovic/shared';
import { type UseQueryOptions, useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const jobCardsKeys = {
  all: ['job-cards'] as const,
  lists: () => [...jobCardsKeys.all, 'list'] as const,
  list: (q: ListJobCardsQuery) => [...jobCardsKeys.lists(), q] as const,
  details: () => [...jobCardsKeys.all, 'detail'] as const,
  detail: (id: string) => [...jobCardsKeys.details(), id] as const,
};

function toQueryString(q: ListJobCardsQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.status) params.set('status', q.status);
  if (q.machineId) params.set('machineId', q.machineId);
  if (q.operatorId) params.set('operatorId', q.operatorId);
  if (q.fromDate) params.set('fromDate', q.fromDate);
  if (q.toDate) params.set('toDate', q.toDate);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useJobCardsList(
  query: ListJobCardsQuery,
  options?: Omit<UseQueryOptions<ListJobCardsResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListJobCardsResponse>({
    queryKey: jobCardsKeys.list(query),
    queryFn: () => apiFetch<ListJobCardsResponse>(`/job-cards?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useJobCard(id: string | undefined) {
  return useQuery<JobCardListItem>({
    queryKey: id ? jobCardsKeys.detail(id) : jobCardsKeys.detail('__missing__'),
    queryFn: () => apiFetch<JobCardListItem>(`/job-cards/${id}`),
    enabled: Boolean(id),
  });
}
