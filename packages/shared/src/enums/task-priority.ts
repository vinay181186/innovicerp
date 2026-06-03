// Task priority. Legacy: High / Medium / Low (default Medium).
export const TASK_PRIORITIES = ['high', 'medium', 'low'] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};
