// Task priority. Legacy: High / Medium / Low (default Medium). ADR-176 adds
// 'urgent' at the top. 'medium' stays as STORED and is LABELLED "Normal" so
// every existing row keeps its value (approved board: Normal / High / Urgent).
export const TASK_PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Normal',
  low: 'Low',
};
