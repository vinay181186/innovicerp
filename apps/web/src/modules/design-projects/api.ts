import type {
  AddDesignCommentInput,
  CreateDesignDcnInput,
  CreateDesignDcrInput,
  CreateDesignIssueInput,
  CreateDesignProjectInput,
  CreateDesignTaskInput,
  DesignDcn,
  DesignDcr,
  DesignIssue,
  DesignProject,
  DesignProjectDetail,
  DesignTask,
  ListDesignProjectsQuery,
  ListDesignProjectsResponse,
  ToggleDesignChecklistItemInput,
  UpdateDesignDcnInput,
  UpdateDesignDcrInput,
  UpdateDesignIssueInput,
  UpdateDesignProjectInput,
  UpdateDesignTaskInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const designProjectsKeys = {
  all: ['design-projects'] as const,
  list: (q: ListDesignProjectsQuery) =>
    [
      ...designProjectsKeys.all,
      'list',
      q.search ?? null,
      q.filter,
      q.limit,
      q.offset,
    ] as const,
  detail: (id: string) => [...designProjectsKeys.all, 'detail', id] as const,
  nextCode: () => [...designProjectsKeys.all, 'next-code'] as const,
};

function buildQs(q: ListDesignProjectsQuery): string {
  const p = new URLSearchParams();
  if (q.search) p.set('search', q.search);
  if (q.filter) p.set('filter', q.filter);
  p.set('limit', String(q.limit));
  p.set('offset', String(q.offset));
  return p.toString();
}

export function useDesignProjectsList(query: ListDesignProjectsQuery) {
  return useQuery<ListDesignProjectsResponse>({
    queryKey: designProjectsKeys.list(query),
    queryFn: () =>
      apiFetch<ListDesignProjectsResponse>(`/design-projects?${buildQs(query)}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

export function useNextDesignProjectCode() {
  return useQuery<{ code: string }>({
    queryKey: designProjectsKeys.nextCode(),
    queryFn: () => apiFetch<{ code: string }>('/design-projects/next-code'),
    staleTime: 0,
  });
}

export function useDesignProjectDetail(id: string | undefined) {
  return useQuery<DesignProjectDetail>({
    queryKey: designProjectsKeys.detail(id ?? '__missing__'),
    queryFn: () => apiFetch<DesignProjectDetail>(`/design-projects/${id}`),
    enabled: Boolean(id),
  });
}

function inv(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: designProjectsKeys.all });
  void qc.invalidateQueries({ queryKey: ['design-issues'] });
}

// Project mutations
export function useCreateDesignProject() {
  const qc = useQueryClient();
  return useMutation<DesignProject, Error, CreateDesignProjectInput>({
    mutationFn: (input) =>
      apiFetch<DesignProject>('/design-projects', { method: 'POST', json: input }),
    onSuccess: () => inv(qc),
  });
}

export function useUpdateDesignProject() {
  const qc = useQueryClient();
  return useMutation<DesignProject, Error, { id: string; input: UpdateDesignProjectInput }>({
    mutationFn: ({ id, input }) =>
      apiFetch<DesignProject>(`/design-projects/${id}`, { method: 'PATCH', json: input }),
    onSuccess: () => inv(qc),
  });
}

export function useToggleDesignChecklist() {
  const qc = useQueryClient();
  return useMutation<DesignProject, Error, { id: string; input: ToggleDesignChecklistItemInput }>({
    mutationFn: ({ id, input }) =>
      apiFetch<DesignProject>(`/design-projects/${id}/checklist`, {
        method: 'POST',
        json: input,
      }),
    onSuccess: () => inv(qc),
  });
}

export function useReleaseDesignProject() {
  const qc = useQueryClient();
  return useMutation<DesignProject, Error, string>({
    mutationFn: (id) =>
      apiFetch<DesignProject>(`/design-projects/${id}/release`, { method: 'POST' }),
    onSuccess: () => inv(qc),
  });
}

// Task mutations
export function useCreateDesignTask() {
  const qc = useQueryClient();
  return useMutation<
    DesignTask,
    Error,
    { projectId: string; input: CreateDesignTaskInput }
  >({
    mutationFn: ({ projectId, input }) =>
      apiFetch<DesignTask>(`/design-projects/${projectId}/tasks`, {
        method: 'POST',
        json: input,
      }),
    onSuccess: () => inv(qc),
  });
}

export function useUpdateDesignTask() {
  const qc = useQueryClient();
  return useMutation<DesignTask, Error, { id: string; input: UpdateDesignTaskInput }>({
    mutationFn: ({ id, input }) =>
      apiFetch<DesignTask>(`/design-tasks/${id}`, { method: 'PATCH', json: input }),
    onSuccess: () => inv(qc),
  });
}

export function useAddDesignTaskComment() {
  const qc = useQueryClient();
  return useMutation<DesignTask, Error, { id: string; input: AddDesignCommentInput }>({
    mutationFn: ({ id, input }) =>
      apiFetch<DesignTask>(`/design-tasks/${id}/comments`, {
        method: 'POST',
        json: input,
      }),
    onSuccess: () => inv(qc),
  });
}

// Issue mutations (writes are nested under projects; list-side hooks live in design-issues module)
export function useCreateDesignIssue() {
  const qc = useQueryClient();
  return useMutation<
    DesignIssue,
    Error,
    { projectId: string; input: CreateDesignIssueInput }
  >({
    mutationFn: ({ projectId, input }) =>
      apiFetch<DesignIssue>(`/design-projects/${projectId}/issues`, {
        method: 'POST',
        json: input,
      }),
    onSuccess: () => inv(qc),
  });
}

export function useUpdateDesignIssue() {
  const qc = useQueryClient();
  return useMutation<DesignIssue, Error, { id: string; input: UpdateDesignIssueInput }>({
    mutationFn: ({ id, input }) =>
      apiFetch<DesignIssue>(`/design-issues/${id}`, { method: 'PATCH', json: input }),
    onSuccess: () => inv(qc),
  });
}

export function useAddDesignIssueComment() {
  const qc = useQueryClient();
  return useMutation<DesignIssue, Error, { id: string; input: AddDesignCommentInput }>({
    mutationFn: ({ id, input }) =>
      apiFetch<DesignIssue>(`/design-issues/${id}/comments`, {
        method: 'POST',
        json: input,
      }),
    onSuccess: () => inv(qc),
  });
}

// DCR / DCN
export function useCreateDesignDcr() {
  const qc = useQueryClient();
  return useMutation<DesignDcr, Error, { projectId: string; input: CreateDesignDcrInput }>({
    mutationFn: ({ projectId, input }) =>
      apiFetch<DesignDcr>(`/design-projects/${projectId}/dcrs`, {
        method: 'POST',
        json: input,
      }),
    onSuccess: () => inv(qc),
  });
}

export function useUpdateDesignDcr() {
  const qc = useQueryClient();
  return useMutation<DesignDcr, Error, { id: string; input: UpdateDesignDcrInput }>({
    mutationFn: ({ id, input }) =>
      apiFetch<DesignDcr>(`/design-dcrs/${id}`, { method: 'PATCH', json: input }),
    onSuccess: () => inv(qc),
  });
}

export function useCreateDesignDcn() {
  const qc = useQueryClient();
  return useMutation<DesignDcn, Error, { projectId: string; input: CreateDesignDcnInput }>({
    mutationFn: ({ projectId, input }) =>
      apiFetch<DesignDcn>(`/design-projects/${projectId}/dcns`, {
        method: 'POST',
        json: input,
      }),
    onSuccess: () => inv(qc),
  });
}

export function useUpdateDesignDcn() {
  const qc = useQueryClient();
  return useMutation<DesignDcn, Error, { id: string; input: UpdateDesignDcnInput }>({
    mutationFn: ({ id, input }) =>
      apiFetch<DesignDcn>(`/design-dcns/${id}`, { method: 'PATCH', json: input }),
    onSuccess: () => inv(qc),
  });
}
