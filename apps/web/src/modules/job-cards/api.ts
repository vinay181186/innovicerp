import type {
  DocumentEditStagedResult,
  JcStatusCountsQuery,
  JcStatusCountsResponse,
  JobCardEditModel,
  JobCardListItem,
  JobCardSaveResult,
  JobCardSourceOption,
  JobCardStatusExtras,
  JobCardWriteInput,
  ListJobCardsQuery,
  ListJobCardsResponse,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const jobCardsKeys = {
  all: ['job-cards'] as const,
  lists: () => [...jobCardsKeys.all, 'list'] as const,
  list: (q: ListJobCardsQuery) => [...jobCardsKeys.lists(), q] as const,
  details: () => [...jobCardsKeys.all, 'detail'] as const,
  detail: (id: string) => [...jobCardsKeys.details(), id] as const,
};

function filterParams(q: JcStatusCountsQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.machineId) params.set('machineId', q.machineId);
  if (q.operatorId) params.set('operatorId', q.operatorId);
  if (q.fromDate) params.set('fromDate', q.fromDate);
  if (q.toDate) params.set('toDate', q.toDate);
  if (q.sf) params.set('sf', q.sf);
  return params;
}

function toQueryString(q: ListJobCardsQuery): string {
  const params = filterParams(q);
  if (q.status) params.set('status', q.status);
  if (q.overdue) params.set('overdue', 'true');
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

/** JC Status dropdown counts (ADR-201): every card the list's other filters
 *  match, counted on the server. Keyed under lists() so every list
 *  invalidation refreshes them too. */
export function useJcStatusCounts(query: JcStatusCountsQuery) {
  return useQuery<JcStatusCountsResponse>({
    queryKey: [...jobCardsKeys.lists(), 'status-counts', query] as const,
    queryFn: () =>
      apiFetch<JcStatusCountsResponse>(
        `/job-cards/status-counts?${filterParams(query).toString()}`,
      ),
    placeholderData: (prev) => prev,
  });
}

export function useNextJcCode(enabled = true) {
  return useQuery<{ code: string }>({
    queryKey: [...jobCardsKeys.all, 'next-code'],
    queryFn: () => apiFetch<{ code: string }>('/job-cards/next-code'),
    enabled,
    staleTime: 0,
  });
}

export function useJobCard(id: string | undefined) {
  return useQuery<JobCardListItem>({
    queryKey: id ? jobCardsKeys.detail(id) : jobCardsKeys.detail('__missing__'),
    queryFn: () => apiFetch<JobCardListItem>(`/job-cards/${id}`),
    enabled: Boolean(id),
  });
}

/** Full write-shaped JC (header + ops + qc docs) to repopulate the edit form. */
export function useJobCardEditModel(id: string | undefined) {
  return useQuery<JobCardEditModel>({
    queryKey: id
      ? ([...jobCardsKeys.detail(id), 'edit'] as const)
      : (['job-cards', 'edit', '__missing__'] as const),
    queryFn: () => apiFetch<JobCardEditModel>(`/job-cards/${id}/edit`),
    enabled: Boolean(id),
  });
}

/** JC Status extras: QC docs, per-op machine name + tool details, and the
 *  merged completion feed (op_log ∪ NC ∪ OSP) with a real server total. */
export function useJobCardStatusExtras(id: string | undefined) {
  return useQuery<JobCardStatusExtras>({
    queryKey: id
      ? ([...jobCardsKeys.detail(id), 'status'] as const)
      : (['job-cards', 'status', '__missing__'] as const),
    queryFn: () => apiFetch<JobCardStatusExtras>(`/job-cards/${id}/status`),
    enabled: Boolean(id),
  });
}

/** Open SO + JW lines (with JC-allocated balance) for the create/edit cascade. */
export function useJobCardSourceOptions(enabled = true) {
  return useQuery<JobCardSourceOption[]>({
    queryKey: [...jobCardsKeys.all, 'source-options'] as const,
    queryFn: () => apiFetch<JobCardSourceOption[]>(`/job-cards/source-options`),
    enabled,
    staleTime: 30_000,
  });
}

export function useCreateJobCard() {
  const qc = useQueryClient();
  return useMutation<JobCardSaveResult, Error, JobCardWriteInput>({
    mutationFn: (input) =>
      apiFetch<JobCardSaveResult>('/job-cards', { method: 'POST', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobCardsKeys.lists() });
    },
  });
}

export function useUpdateJobCard(id: string) {
  const qc = useQueryClient();
  // ADR-202 — when the edit-approval gate is on and the Job Card is live, the
  // PATCH returns a DocumentEditStagedResult (the edit was staged for approval)
  // instead of the saved card. Callers read the union to tell them apart.
  return useMutation<JobCardSaveResult | DocumentEditStagedResult, Error, JobCardWriteInput>({
    mutationFn: (input) =>
      apiFetch<JobCardSaveResult | DocumentEditStagedResult>(`/job-cards/${id}`, {
        method: 'PATCH',
        json: input,
      }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: jobCardsKeys.lists() });
      if ('staged' in updated) {
        // Nothing changed on the Job Card itself — refresh so the status page
        // shows the new pending-change chips.
        void qc.invalidateQueries({ queryKey: jobCardsKeys.detail(id) });
        void qc.invalidateQueries({ queryKey: ['document-edits'] });
        return;
      }
      qc.setQueryData(jobCardsKeys.detail(id), updated);
    },
  });
}

export function useDeleteJobCard() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await apiFetch<null>(`/job-cards/${id}`, { method: 'DELETE' });
    },
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: jobCardsKeys.lists() });
      qc.removeQueries({ queryKey: jobCardsKeys.detail(id) });
    },
  });
}
