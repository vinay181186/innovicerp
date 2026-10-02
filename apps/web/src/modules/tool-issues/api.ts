// Tool Issue register (ADR-193 phase 4b) — TanStack Query hooks.
import type {
  CancelToolIssueInput,
  CreateToolIssueInput,
  DecideToolWriteoffInput,
  ListToolHoldersQuery,
  ListToolHoldersResponse,
  ListToolIssuesQuery,
  ListToolIssuesResponse,
  ListToolWriteoffsQuery,
  ListToolWriteoffsResponse,
  RecordToolReturnInput,
  ReturnInstrumentsInput,
  ToolIssueDetail,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { activityLogKeys } from '@/modules/activity-log/api';

export const toolIssuesKeys = {
  all: ['tool-issues'] as const,
  list: (q: ListToolIssuesQuery) =>
    [
      ...toolIssuesKeys.all,
      'list',
      q.search ?? null,
      q.filter,
      q.sf ?? null,
      q.limit,
      q.offset,
    ] as const,
  detail: (id: string) => [...toolIssuesKeys.all, 'detail', id] as const,
  holders: (q: ListToolHoldersQuery) =>
    [...toolIssuesKeys.all, 'holders', q.sf ?? null, q.limit, q.offset] as const,
  writeoffs: (q: ListToolWriteoffsQuery) =>
    [
      ...toolIssuesKeys.all,
      'writeoffs',
      q.status ?? null,
      q.sf ?? null,
      q.limit,
      q.offset,
    ] as const,
};

function buildSearch(q: ListToolIssuesQuery): string {
  const p = new URLSearchParams();
  if (q.search) p.set('search', q.search);
  p.set('filter', q.filter);
  if (q.sf) p.set('sf', q.sf);
  p.set('limit', String(q.limit));
  p.set('offset', String(q.offset));
  return p.toString();
}

export function useToolIssuesList(query: ListToolIssuesQuery) {
  return useQuery<ListToolIssuesResponse>({
    queryKey: toolIssuesKeys.list(query),
    queryFn: () => apiFetch<ListToolIssuesResponse>(`/tool-issues?${buildSearch(query)}`),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useToolIssue(id: string | null) {
  return useQuery<ToolIssueDetail>({
    queryKey: toolIssuesKeys.detail(id ?? ''),
    queryFn: () => apiFetch<ToolIssueDetail>(`/tool-issues/${id}`),
    enabled: Boolean(id),
  });
}

/** Who holds what — one page (ADR-201) + the total still out. */
export function useToolHolders(query: ListToolHoldersQuery, enabled: boolean) {
  return useQuery<ListToolHoldersResponse>({
    queryKey: toolIssuesKeys.holders(query),
    queryFn: () => {
      const p = new URLSearchParams();
      if (query.sf) p.set('sf', query.sf);
      p.set('limit', String(query.limit));
      p.set('offset', String(query.offset));
      return apiFetch<ListToolHoldersResponse>(`/tool-issues/holders?${p.toString()}`);
    },
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useToolWriteoffs(query: ListToolWriteoffsQuery, enabled: boolean) {
  return useQuery<ListToolWriteoffsResponse>({
    queryKey: toolIssuesKeys.writeoffs(query),
    queryFn: () => {
      const p = new URLSearchParams();
      if (query.status) p.set('status', query.status);
      if (query.sf) p.set('sf', query.sf);
      p.set('limit', String(query.limit));
      p.set('offset', String(query.offset));
      return apiFetch<ListToolWriteoffsResponse>(`/tool-writeoffs?${p.toString()}`);
    },
    enabled,
    placeholderData: (prev) => prev,
  });
}

/** A tool moved → registers, instruments and stock screens re-read. */
function invalidate(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: toolIssuesKeys.all });
  void qc.invalidateQueries({ queryKey: ['instruments'] });
  void qc.invalidateQueries({ queryKey: ['store-inventory'] });
  void qc.invalidateQueries({ queryKey: ['store-transactions'] });
  void qc.invalidateQueries({ queryKey: ['items'] });
  void qc.invalidateQueries({ queryKey: activityLogKeys.all });
}

export function useCreateToolIssue() {
  const qc = useQueryClient();
  return useMutation<ToolIssueDetail, Error, CreateToolIssueInput>({
    mutationFn: (input) =>
      apiFetch<ToolIssueDetail>('/tool-issues', { method: 'POST', json: input }),
    onSuccess: () => invalidate(qc),
  });
}

export function useRecordToolReturn() {
  const qc = useQueryClient();
  return useMutation<ToolIssueDetail, Error, { id: string } & RecordToolReturnInput>({
    mutationFn: ({ id, ...body }) =>
      apiFetch<ToolIssueDetail>(`/tool-issues/${id}/return`, { method: 'POST', json: body }),
    onSuccess: () => invalidate(qc),
  });
}

export function useReturnInstruments() {
  const qc = useQueryClient();
  return useMutation<ToolIssueDetail, Error, { id: string } & ReturnInstrumentsInput>({
    mutationFn: ({ id, ...body }) =>
      apiFetch<ToolIssueDetail>(`/tool-issues/${id}/return-instruments`, {
        method: 'POST',
        json: body,
      }),
    onSuccess: () => invalidate(qc),
  });
}

export function useCancelToolIssue() {
  const qc = useQueryClient();
  return useMutation<ToolIssueDetail, Error, { id: string } & CancelToolIssueInput>({
    mutationFn: ({ id, ...body }) =>
      apiFetch<ToolIssueDetail>(`/tool-issues/${id}/cancel`, { method: 'POST', json: body }),
    onSuccess: () => invalidate(qc),
  });
}

export function useDecideToolWriteoff() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { id: string } & DecideToolWriteoffInput>({
    mutationFn: ({ id, ...body }) =>
      apiFetch(`/tool-writeoffs/${id}/decide`, { method: 'POST', json: body }),
    onSuccess: () => invalidate(qc),
  });
}
