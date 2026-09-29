// Tool Issue register (ADR-193 phase 4b) — TanStack Query hooks.
import type {
  CancelToolIssueInput,
  CreateToolIssueInput,
  DecideToolWriteoffInput,
  ListToolIssuesQuery,
  ListToolIssuesResponse,
  ListToolWriteoffsQuery,
  ListToolWriteoffsResponse,
  RecordToolReturnInput,
  ReturnInstrumentsInput,
  ToolHolderRow,
  ToolIssueDetail,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const toolIssuesKeys = {
  all: ['tool-issues'] as const,
  list: (q: ListToolIssuesQuery) =>
    [...toolIssuesKeys.all, 'list', q.search ?? null, q.filter, q.limit, q.offset] as const,
  detail: (id: string) => [...toolIssuesKeys.all, 'detail', id] as const,
  holders: () => [...toolIssuesKeys.all, 'holders'] as const,
  writeoffs: (q: ListToolWriteoffsQuery) =>
    [...toolIssuesKeys.all, 'writeoffs', q.status ?? null, q.limit, q.offset] as const,
};

function buildSearch(q: ListToolIssuesQuery): string {
  const p = new URLSearchParams();
  if (q.search) p.set('search', q.search);
  p.set('filter', q.filter);
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

export function useToolHolders(enabled: boolean) {
  return useQuery<ToolHolderRow[]>({
    queryKey: toolIssuesKeys.holders(),
    queryFn: () => apiFetch<ToolHolderRow[]>('/tool-issues/holders'),
    enabled,
  });
}

export function useToolWriteoffs(query: ListToolWriteoffsQuery, enabled: boolean) {
  return useQuery<ListToolWriteoffsResponse>({
    queryKey: toolIssuesKeys.writeoffs(query),
    queryFn: () => {
      const p = new URLSearchParams();
      if (query.status) p.set('status', query.status);
      p.set('limit', String(query.limit));
      p.set('offset', String(query.offset));
      return apiFetch<ListToolWriteoffsResponse>(`/tool-writeoffs?${p.toString()}`);
    },
    enabled,
  });
}

/** A tool moved → registers, instruments and stock screens re-read. */
function invalidate(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: toolIssuesKeys.all });
  void qc.invalidateQueries({ queryKey: ['instruments'] });
  void qc.invalidateQueries({ queryKey: ['store-inventory'] });
  void qc.invalidateQueries({ queryKey: ['store-transactions'] });
  void qc.invalidateQueries({ queryKey: ['items'] });
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
