// Task (taskAllocations) status. Legacy stores display strings 'To Do' /
// 'In Progress' / 'Completed'; 'Cancelled' appears in filters. We store
// canonical tokens and map labels. 'Overdue' is DERIVED, never stored
// (status != completed && due_date < today).
export const TASK_STATUSES = ['todo', 'in_progress', 'completed', 'cancelled'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
