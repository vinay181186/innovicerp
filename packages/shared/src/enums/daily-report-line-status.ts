// Per-line status inside a Daily Task Report. Legacy: Completed / In Progress /
// Pending / Blocked (default Completed). Distinct from task_status (no
// 'cancelled', has 'pending'/'blocked').
export const DAILY_REPORT_LINE_STATUSES = [
  'completed',
  'in_progress',
  'pending',
  'blocked',
] as const;

export type DailyReportLineStatus = (typeof DAILY_REPORT_LINE_STATUSES)[number];

export const DAILY_REPORT_LINE_STATUS_LABELS: Record<DailyReportLineStatus, string> = {
  completed: 'Completed',
  in_progress: 'In Progress',
  pending: 'Pending',
  blocked: 'Blocked',
};
