// Task type (ADR-176). 'assigned' = one person gives work to another (the
// original Task Board row); 'personal' = a My To-Do the user writes for
// themself (created_by = assigned_to = the logged-in user, set server-side).
export const TASK_TYPES = ['assigned', 'personal'] as const;

export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  assigned: 'Assigned',
  personal: 'My To-Do',
};

// The four filtered views over the one tasks table. 'all' is admin-only and
// the server enforces it (never just hidden on the web).
export const TASK_VIEWS = ['inbox', 'outbox', 'todo', 'all'] as const;

export type TaskView = (typeof TASK_VIEWS)[number];

export const TASK_VIEW_LABELS: Record<TaskView, string> = {
  inbox: 'Inbox',
  outbox: 'Outbox',
  todo: 'My To-Do',
  all: 'All Tasks',
};

// Due-date quick filter on the board.
export const TASK_DUE_FILTERS = ['today', 'week', 'overdue'] as const;
export type TaskDueFilter = (typeof TASK_DUE_FILTERS)[number];

// "Related To" document kinds offered by the standalone Assign Task form.
// linked_ref_type is free text (contextual Assign buttons also pass 'grn',
// 'capa', 'purchase_request', 'design_issue'); these six get a picker.
export const TASK_RELATED_TYPES = [
  'sales_order',
  'job_card',
  'purchase_order',
  'qc_call',
  'nc',
  'design_project',
] as const;

export type TaskRelatedType = (typeof TASK_RELATED_TYPES)[number];

export const TASK_RELATED_TYPE_LABELS: Record<TaskRelatedType, string> = {
  sales_order: 'Sales Order',
  job_card: 'Job Card',
  purchase_order: 'Purchase Order',
  qc_call: 'QC Call',
  nc: 'NC',
  design_project: 'Design Project',
};

// Append-only task_history.action vocabulary.
export const TASK_HISTORY_ACTIONS = [
  'created',
  'reassigned',
  'status_changed',
  'priority_changed',
  'due_date_changed',
  'edited',
  'comment',
  'attachment',
  'completed',
  'cancelled',
] as const;

export type TaskHistoryAction = (typeof TASK_HISTORY_ACTIONS)[number];

export const TASK_HISTORY_ACTION_LABELS: Record<TaskHistoryAction, string> = {
  created: 'Task created',
  reassigned: 'Reassigned',
  status_changed: 'Status changed',
  priority_changed: 'Priority changed',
  due_date_changed: 'Due date changed',
  edited: 'Details edited',
  comment: 'Remark added',
  attachment: 'Attachment added',
  completed: 'Task completed',
  cancelled: 'Task cancelled',
};
