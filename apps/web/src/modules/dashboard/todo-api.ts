// ADR-262 — the home's to-do writes. Kept apart from api.ts because they import
// taskKeys from modules/tasks/api, which itself imports dashboardKeys from
// ./api (one direction only, no import cycle).
//
// Create: "Me" → POST /tasks/personal; someone else → POST /tasks (Due Date
// required). One Idempotency-Key per open form (useSaveKey, ADR-172), so a
// double click or a resend makes ONE to-do.
// Complete: POST /tasks/:id/complete — answers 409 when it is already done.

import type { CreatePersonalTodoInput, CreateTaskInput, TaskDetail } from '@innovic/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { taskKeys } from '@/modules/tasks/api';
import { dashboardKeys } from './api';

export type CreateTodoInput =
  | { kind: 'me'; input: CreatePersonalTodoInput }
  | { kind: 'other'; input: CreateTaskInput };

function useInvalidateTodo(): () => void {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: taskKeys.all });
    void qc.invalidateQueries({ queryKey: dashboardKeys.home() });
  };
}

export function useCreateTodo(saveKey: SaveKey) {
  const invalidate = useInvalidateTodo();
  return useMutation<TaskDetail, Error, CreateTodoInput>({
    mutationFn: (v) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<TaskDetail>(v.kind === 'me' ? '/tasks/personal' : '/tasks', {
          method: 'POST',
          json: v.input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: invalidate,
  });
}

/** Tick a to-do done. A refusal (409 already done) refetches too, so the row
 *  shows what the server holds. */
export function useCompleteTodo() {
  const invalidate = useInvalidateTodo();
  return useMutation<TaskDetail, Error, string>({
    mutationFn: (taskId) =>
      apiFetch<TaskDetail>(`/tasks/${taskId}/complete`, { method: 'POST', json: {} }),
    onSettled: invalidate,
  });
}
