import type {
  CreateTaskInput,
  ListTasksResponse,
  TaskDetail,
  TaskUserOption,
  UpdateTaskStatusInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export interface TaskListFilters {
  assignedTo?: string | undefined;
  status?: string | undefined;
  priority?: string | undefined;
}

export const taskKeys = {
  all: ['tasks'] as const,
  list: (f: TaskListFilters) => [...taskKeys.all, 'list', f] as const,
  detail: (id: string) => [...taskKeys.all, 'detail', id] as const,
  userOptions: () => [...taskKeys.all, 'user-options'] as const,
  nextCode: () => [...taskKeys.all, 'next-code'] as const,
};

function toQuery(f: TaskListFilters): string {
  const p = new URLSearchParams();
  if (f.assignedTo) p.set('assignedTo', f.assignedTo);
  if (f.status) p.set('status', f.status);
  if (f.priority) p.set('priority', f.priority);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function useTaskList(filters: TaskListFilters) {
  return useQuery<ListTasksResponse>({
    queryKey: taskKeys.list(filters),
    queryFn: () => apiFetch<ListTasksResponse>(`/tasks${toQuery(filters)}`),
    staleTime: 15_000,
  });
}

export function useTaskDetail(id: string | undefined) {
  return useQuery<TaskDetail>({
    queryKey: id ? taskKeys.detail(id) : taskKeys.detail('__none__'),
    queryFn: () => apiFetch<TaskDetail>(`/tasks/${id}`),
    enabled: Boolean(id),
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

export function useNextTaskCode() {
  return useQuery<{ code: string }>({
    queryKey: taskKeys.nextCode(),
    queryFn: () => apiFetch<{ code: string }>('/tasks/next-code'),
    staleTime: 0,
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation<TaskDetail, Error, CreateTaskInput>({
    mutationFn: (input) => apiFetch<TaskDetail>('/tasks', { method: 'POST', json: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: taskKeys.all }),
  });
}

export function useUpdateTaskStatus(id: string) {
  const qc = useQueryClient();
  return useMutation<TaskDetail, Error, UpdateTaskStatusInput>({
    mutationFn: (input) =>
      apiFetch<TaskDetail>(`/tasks/${id}/status`, { method: 'POST', json: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: taskKeys.all }),
  });
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
