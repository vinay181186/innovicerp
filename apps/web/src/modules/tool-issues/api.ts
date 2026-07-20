import type {
  CreateToolIssueInput,
  ListToolIssuesQuery,
  ListToolIssuesResponse,
  RecordToolReturnInput,
  ToolIssue,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const toolIssuesKeys = {
  all: ['tool-issues'] as const,
  list: (q: ListToolIssuesQuery) =>
    [...toolIssuesKeys.all, 'list', q.search ?? null, q.filter, q.limit, q.offset] as const,
  nextCode: () => [...toolIssuesKeys.all, 'next-code'] as const,
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
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

export function useNextToolIssueCode() {
  return useQuery<{ code: string }>({
    queryKey: toolIssuesKeys.nextCode(),
    queryFn: () => apiFetch<{ code: string }>('/tool-issues/next-code'),
    staleTime: 0,
  });
}

export function useCreateToolIssue() {
  const qc = useQueryClient();
  return useMutation<ToolIssue, Error, CreateToolIssueInput>({
    mutationFn: (input) =>
      apiFetch<ToolIssue>('/tool-issues', { method: 'POST', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: toolIssuesKeys.all });
      void qc.invalidateQueries({ queryKey: ['store-inventory'] });
      void qc.invalidateQueries({ queryKey: ['store-transactions'] });
    },
  });
}

export function useRecordToolReturn(toolIssueId: string) {
  const qc = useQueryClient();
  return useMutation<ToolIssue, Error, RecordToolReturnInput>({
    mutationFn: (input) =>
      apiFetch<ToolIssue>(`/tool-issues/${toolIssueId}/return`, {
        method: 'POST',
        json: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: toolIssuesKeys.all });
      void qc.invalidateQueries({ queryKey: ['store-inventory'] });
      void qc.invalidateQueries({ queryKey: ['store-transactions'] });
    },
  });
}
