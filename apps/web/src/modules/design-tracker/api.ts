import type {
  CreateDesignTrackerInput,
  DesignTimeLogEntry,
  DesignTracker,
  DesignTrackerDetailResponse,
  ListDesignTrackerQuery,
  ListDesignTrackerResponse,
  LogDesignTimeInput,
  ReviseDesignInput,
  UpdateDesignTrackerInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const designTrackerKeys = {
  all: ['design-tracker'] as const,
  list: (q: ListDesignTrackerQuery) =>
    [
      ...designTrackerKeys.all,
      'list',
      q.search ?? null,
      q.status ?? null,
      q.filter,
      q.limit,
      q.offset,
    ] as const,
  detail: (id: string) => [...designTrackerKeys.all, 'detail', id] as const,
  nextCode: () => [...designTrackerKeys.all, 'next-code'] as const,
};

function buildQs(q: ListDesignTrackerQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.status) params.set('status', q.status);
  if (q.filter) params.set('filter', q.filter);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useDesignTrackerList(query: ListDesignTrackerQuery) {
  return useQuery<ListDesignTrackerResponse>({
    queryKey: designTrackerKeys.list(query),
    queryFn: () => apiFetch<ListDesignTrackerResponse>(`/design-tracker?${buildQs(query)}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

export function useDesignTrackerDetail(id: string | undefined) {
  return useQuery<DesignTrackerDetailResponse>({
    queryKey: designTrackerKeys.detail(id ?? '__missing__'),
    queryFn: () => apiFetch<DesignTrackerDetailResponse>(`/design-tracker/${id}`),
    enabled: Boolean(id),
  });
}

export function useNextDesignTrackerCode() {
  return useQuery<{ code: string }>({
    queryKey: designTrackerKeys.nextCode(),
    queryFn: () => apiFetch<{ code: string }>('/design-tracker/next-code'),
    staleTime: 0,
  });
}

function inv(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: designTrackerKeys.all });
}

export function useCreateDesignTracker() {
  const qc = useQueryClient();
  return useMutation<DesignTracker, Error, CreateDesignTrackerInput>({
    mutationFn: (input) =>
      apiFetch<DesignTracker>('/design-tracker', { method: 'POST', json: input }),
    onSuccess: () => inv(qc),
  });
}

export function useUpdateDesignTracker() {
  const qc = useQueryClient();
  return useMutation<DesignTracker, Error, { id: string; input: UpdateDesignTrackerInput }>({
    mutationFn: ({ id, input }) =>
      apiFetch<DesignTracker>(`/design-tracker/${id}`, { method: 'PATCH', json: input }),
    onSuccess: () => inv(qc),
  });
}

export function useLogDesignTime() {
  const qc = useQueryClient();
  return useMutation<DesignTimeLogEntry, Error, { id: string; input: LogDesignTimeInput }>({
    mutationFn: ({ id, input }) =>
      apiFetch<DesignTimeLogEntry>(`/design-tracker/${id}/time`, {
        method: 'POST',
        json: input,
      }),
    onSuccess: () => inv(qc),
  });
}

export function useSubmitDesignReview() {
  const qc = useQueryClient();
  return useMutation<DesignTracker, Error, string>({
    mutationFn: (id) =>
      apiFetch<DesignTracker>(`/design-tracker/${id}/submit-review`, { method: 'POST' }),
    onSuccess: () => inv(qc),
  });
}

export function useApproveDesign() {
  const qc = useQueryClient();
  return useMutation<DesignTracker, Error, string>({
    mutationFn: (id) =>
      apiFetch<DesignTracker>(`/design-tracker/${id}/approve`, { method: 'POST' }),
    onSuccess: () => inv(qc),
  });
}

export function useReviseDesign() {
  const qc = useQueryClient();
  return useMutation<DesignTracker, Error, { id: string; input: ReviseDesignInput }>({
    mutationFn: ({ id, input }) =>
      apiFetch<DesignTracker>(`/design-tracker/${id}/revise`, {
        method: 'POST',
        json: input,
      }),
    onSuccess: () => inv(qc),
  });
}
