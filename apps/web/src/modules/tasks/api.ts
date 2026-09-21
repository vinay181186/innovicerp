// Task Board data hooks (ADR-176). One hook per endpoint; every mutation
// invalidates `taskKeys.all` so the board, its tab counters, the unread badge
// and any open detail refetch together.

import type {
  AddTaskCommentInput,
  CancelTaskInput,
  CompleteTaskInput,
  CreatePersonalTodoInput,
  CreateTaskInput,
  ListTasksQuery,
  ListTasksResponse,
  ReassignTaskInput,
  TaskAttachmentInput,
  TaskDetail,
  TaskHistoryEntry,
  TaskRelatedOption,
  TaskRelatedType,
  TaskType,
  TaskUserOption,
  UpdateTaskInput,
  UpdateTaskStatusInput,
} from '@innovic/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const taskKeys = {
  all: ['tasks'] as const,
  list: (q: ListTasksQuery) => [...taskKeys.all, 'list', q] as const,
  detail: (id: string) => [...taskKeys.all, 'detail', id] as const,
  history: (id: string) => [...taskKeys.all, 'history', id] as const,
  userOptions: () => [...taskKeys.all, 'user-options'] as const,
  relatedOptions: (type: string, search: string) =>
    [...taskKeys.all, 'related-options', type, search] as const,
  nextCode: (type: TaskType) => [...taskKeys.all, 'next-code', type] as const,
};

function toQuery(q: ListTasksQuery): string {
  const p = new URLSearchParams();
  p.set('view', q.view);
  if (q.search) p.set('search', q.search);
  if (q.status) p.set('status', q.status);
  if (q.priority) p.set('priority', q.priority);
  if (q.person) p.set('person', q.person);
  if (q.assignedBy) p.set('assignedBy', q.assignedBy);
  if (q.due) p.set('due', q.due);
  if (q.dept) p.set('dept', q.dept);
  return `?${p.toString()}`;
}

// ── Reads ──

export function useTaskList(query: ListTasksQuery) {
  return useQuery<ListTasksResponse>({
    queryKey: taskKeys.list(query),
    queryFn: () => apiFetch<ListTasksResponse>(`/tasks${toQuery(query)}`),
    staleTime: 15_000,
    // Switching a tab or a filter keeps the board on screen (with the
    // "Updating…" mark) instead of flashing the whole page to "Loading…".
    placeholderData: keepPreviousData,
  });
}

export function useTaskDetail(id: string | undefined) {
  return useQuery<TaskDetail>({
    queryKey: id ? taskKeys.detail(id) : taskKeys.detail('__none__'),
    queryFn: () => apiFetch<TaskDetail>(`/tasks/${id}`),
    enabled: Boolean(id),
  });
}

export function useTaskHistory(id: string | undefined, enabled = true) {
  return useQuery<{ history: TaskHistoryEntry[] }>({
    queryKey: id ? taskKeys.history(id) : taskKeys.history('__none__'),
    queryFn: () => apiFetch<{ history: TaskHistoryEntry[] }>(`/tasks/${id}/history`),
    enabled: Boolean(id) && enabled,
  });
}

export function useTaskUserOptions(enabled = true) {
  return useQuery<{ options: TaskUserOption[] }>({
    queryKey: taskKeys.userOptions(),
    queryFn: () => apiFetch<{ options: TaskUserOption[] }>('/tasks/user-options'),
    staleTime: 60_000,
    enabled,
  });
}

/** "Reference No." picker feed — documents of one Related-To type matching the
 *  typed term. Disabled until a type is chosen. */
export function useRelatedOptions(type: TaskRelatedType | '', search: string, enabled = true) {
  const p = new URLSearchParams();
  p.set('type', type);
  if (search) p.set('search', search);
  return useQuery<{ options: TaskRelatedOption[] }>({
    queryKey: taskKeys.relatedOptions(type, search),
    queryFn: () =>
      apiFetch<{ options: TaskRelatedOption[] }>(`/tasks/related-options?${p.toString()}`),
    enabled: enabled && type !== '',
    staleTime: 30_000,
  });
}

export function useNextTaskCode(type: TaskType, enabled = true) {
  return useQuery<{ code: string }>({
    queryKey: taskKeys.nextCode(type),
    queryFn: () => apiFetch<{ code: string }>(`/tasks/next-code?type=${type}`),
    staleTime: 0,
    enabled,
  });
}

// ── Writes ──

function useTaskMutation<TInput, TOut = TaskDetail>(run: (input: TInput) => Promise<TOut>) {
  const qc = useQueryClient();
  return useMutation<TOut, Error, TInput>({
    mutationFn: run,
    onSuccess: () => void qc.invalidateQueries({ queryKey: taskKeys.all }),
  });
}

export function useCreateTask() {
  return useTaskMutation<CreateTaskInput>((input) =>
    apiFetch<TaskDetail>('/tasks', { method: 'POST', json: input }),
  );
}

export function useCreatePersonalTodo() {
  return useTaskMutation<CreatePersonalTodoInput>((input) =>
    apiFetch<TaskDetail>('/tasks/personal', { method: 'POST', json: input }),
  );
}

export function useUpdateTask(id: string) {
  return useTaskMutation<UpdateTaskInput>((input) =>
    apiFetch<TaskDetail>(`/tasks/${id}`, { method: 'PATCH', json: input }),
  );
}

export function useUpdateTaskStatus(id: string) {
  return useTaskMutation<UpdateTaskStatusInput>((input) =>
    apiFetch<TaskDetail>(`/tasks/${id}/status`, { method: 'POST', json: input }),
  );
}

export function useCompleteTask(id: string) {
  return useTaskMutation<CompleteTaskInput>((input) =>
    apiFetch<TaskDetail>(`/tasks/${id}/complete`, { method: 'POST', json: input }),
  );
}

export function useCancelTask(id: string) {
  return useTaskMutation<CancelTaskInput>((input) =>
    apiFetch<TaskDetail>(`/tasks/${id}/cancel`, { method: 'POST', json: input }),
  );
}

export function useReassignTask(id: string) {
  return useTaskMutation<ReassignTaskInput>((input) =>
    apiFetch<TaskDetail>(`/tasks/${id}/reassign`, { method: 'POST', json: input }),
  );
}

export function useAddTaskComment(id: string) {
  return useTaskMutation<AddTaskCommentInput>((input) =>
    apiFetch<TaskDetail>(`/tasks/${id}/comments`, { method: 'POST', json: input }),
  );
}

export function useAddTaskAttachment(id: string) {
  return useTaskMutation<TaskAttachmentInput>((input) =>
    apiFetch<TaskDetail>(`/tasks/${id}/attachments`, { method: 'POST', json: input }),
  );
}

export function useMarkTasksViewed() {
  const qc = useQueryClient();
  return useMutation<{ updated: number }, Error, void>({
    mutationFn: () => apiFetch<{ updated: number }>('/tasks/mark-viewed', { method: 'POST' }),
    onSuccess: (res) => {
      if (res.updated > 0) void qc.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}
