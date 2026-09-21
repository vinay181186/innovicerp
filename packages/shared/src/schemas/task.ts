// Task Board shared schemas (migrations 0051 + 0139, ADR-176). One tasks
// table, four filtered views (Inbox / Outbox / My To-Do / All Tasks) plus
// personal to-dos, an append-only history trail, remarks and attachments.
// Each task's comments / history / files live in their own rows — no
// embedded JSON arrays (CLAUDE.md anti-pattern #1).
//
// Who-am-I is NEVER trusted from the browser: created_by / assigned_by come
// from the authenticated user, and a personal to-do's assignee is forced to
// the caller server-side.

import { z } from 'zod';
import { TASK_PRIORITIES } from '../enums/task-priority';
import { TASK_STATUSES } from '../enums/task-status';
import {
  TASK_DUE_FILTERS,
  TASK_HISTORY_ACTIONS,
  TASK_RELATED_TYPES,
  TASK_TYPES,
  TASK_VIEWS,
} from '../enums/task-type';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// A contextual link to a source record (SO/JC/PO/QC call/NC/Design project,
// plus PR/GRN/CAPA/design issue from the contextual Assign buttons).
export const taskLinkedRefSchema = z.object({
  type: z.string().max(32),
  id: z.string().max(128),
  display: z.string().max(255),
  navPage: z.string().max(64),
});
export type TaskLinkedRef = z.infer<typeof taskLinkedRefSchema>;

// A file already uploaded to Storage by the browser (lib/storage uploadFile),
// registered against the task. Same shape SO / JWSO documents use.
export const taskAttachmentInputSchema = z.object({
  fileName: z.string().min(1).max(255),
  storagePath: z.string().min(1).max(512),
  fileSize: z.number().int().nonnegative().optional(),
  fileType: z.string().max(128).optional(),
});
export type TaskAttachmentInput = z.infer<typeof taskAttachmentInputSchema>;

// ── Create: assigned task ("+ Assign Task", standalone or contextual) ──
export const createTaskInputSchema = z.object({
  title: z.string().min(1, 'Title required').max(255),
  description: z.string().max(2000).optional(),
  assignedTo: z.string().uuid(),
  priority: z.enum(TASK_PRIORITIES).default('medium'),
  startDate: dateStr.optional(),
  dueDate: dateStr,
  linkedRef: taskLinkedRefSchema.nullish(),
  attachments: z.array(taskAttachmentInputSchema).max(10).optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;

// ── Create: personal to-do ("+ My To-Do") — assignee is the caller ──
export const createPersonalTodoInputSchema = z.object({
  title: z.string().min(1, 'Title required').max(255),
  description: z.string().max(2000).optional(),
  priority: z.enum(TASK_PRIORITIES).default('medium'),
  dueDate: dateStr.optional(),
  reminderAt: z.string().datetime({ offset: true }).optional(),
});
export type CreatePersonalTodoInput = z.infer<typeof createPersonalTodoInputSchema>;

// ── Edit details (creator or admin). Priority / due-date changes are
// history-logged individually; other fields as one 'edited' entry. ──
export const updateTaskInputSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  startDate: dateStr.nullable().optional(),
  dueDate: dateStr.nullable().optional(),
  reminderAt: z.string().datetime({ offset: true }).nullable().optional(),
  linkedRef: taskLinkedRefSchema.nullable().optional(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;

// ── Update status (+ optional progress comment). Kept for the existing
// Update Status modal; 'completed' here behaves like /complete without a
// remark, 'cancelled' like /cancel. ──
export const updateTaskStatusInputSchema = z.object({
  status: z.enum(TASK_STATUSES),
  comment: z.string().max(2000).optional(),
});
export type UpdateTaskStatusInput = z.infer<typeof updateTaskStatusInputSchema>;

// ── Complete (assignee, creator or admin) ──
export const completeTaskInputSchema = z.object({
  remark: z.string().max(2000).optional(),
  attachments: z.array(taskAttachmentInputSchema).max(10).optional(),
});
export type CompleteTaskInput = z.infer<typeof completeTaskInputSchema>;

// ── Cancel (creator or admin) ──
export const cancelTaskInputSchema = z.object({
  reason: z.string().max(2000).optional(),
});
export type CancelTaskInput = z.infer<typeof cancelTaskInputSchema>;

// ── Reassign (creator or admin) ──
export const reassignTaskInputSchema = z.object({
  assignedTo: z.string().uuid(),
  note: z.string().max(2000).optional(),
});
export type ReassignTaskInput = z.infer<typeof reassignTaskInputSchema>;

// ── Remark (anyone who can view the task) ──
export const addTaskCommentInputSchema = z.object({
  text: z.string().min(1, 'Remark required').max(2000),
});
export type AddTaskCommentInput = z.infer<typeof addTaskCommentInputSchema>;

// ── List query ──
export const listTasksQuerySchema = z.object({
  view: z.enum(TASK_VIEWS).default('inbox'),
  search: z.string().max(120).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  // The "person" column of the current view: Inbox → assigned by,
  // Outbox / All → assigned to. Explicit assignedBy is for All Tasks.
  person: z.string().uuid().optional(),
  assignedBy: z.string().uuid().optional(),
  due: z.enum(TASK_DUE_FILTERS).optional(),
  // All Tasks only — assignee's main department (Access Control main_dept).
  dept: z.string().max(32).optional(),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

// ── Related-To lookup ("Reference No." picker) ──
export const relatedOptionsQuerySchema = z.object({
  type: z.enum(TASK_RELATED_TYPES),
  search: z.string().max(80).optional(),
});
export type RelatedOptionsQuery = z.infer<typeof relatedOptionsQuerySchema>;

export const taskRelatedOptionSchema = z.object({
  id: z.string(), // uuid of the record (jc_op id for a QC call)
  code: z.string(), // document number shown in the picker + stored as display
  hint: z.string().nullable(), // party / item / op — one line of context
});
export type TaskRelatedOption = z.infer<typeof taskRelatedOptionSchema>;

// ── Read models ──
export const taskCommentSchema = z.object({
  id: z.string().uuid(),
  byId: z.string().uuid(),
  by: z.string(), // author full name
  date: z.string(),
  createdAt: z.string(),
  text: z.string(),
});
export type TaskComment = z.infer<typeof taskCommentSchema>;

export const taskAttachmentSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  storagePath: z.string(),
  fileSize: z.number().int().nullable(),
  fileType: z.string().nullable(),
  uploadedBy: z.string(), // full name
  createdAt: z.string(),
});
export type TaskAttachment = z.infer<typeof taskAttachmentSchema>;

export const taskHistoryEntrySchema = z.object({
  id: z.string().uuid(),
  action: z.enum(TASK_HISTORY_ACTIONS),
  fromValue: z.string().nullable(),
  toValue: z.string().nullable(),
  note: z.string().nullable(),
  by: z.string(), // full name
  at: z.string(), // ISO timestamp
});
export type TaskHistoryEntry = z.infer<typeof taskHistoryEntrySchema>;

// What the caller may do with this row — computed server-side from the same
// rules the mutations enforce, so the web only shows what will succeed.
export const taskPermissionsSchema = z.object({
  canUpdateStatus: z.boolean(), // assignee / creator / admin
  canComplete: z.boolean(),
  canCancel: z.boolean(), // creator / admin
  canReassign: z.boolean(), // creator / admin
  canEdit: z.boolean(), // creator / admin
  canComment: z.boolean(), // anyone who can view
  canAttach: z.boolean(), // anyone who can view, not 'viewer' role
});
export type TaskPermissions = z.infer<typeof taskPermissionsSchema>;

export const taskRowSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  taskType: z.enum(TASK_TYPES),
  title: z.string(),
  description: z.string().nullable(),
  createdBy: z.string().uuid(),
  createdByName: z.string().nullable(),
  assignedTo: z.string().uuid().nullable(),
  assignedToName: z.string().nullable(),
  assignedBy: z.string().uuid().nullable(),
  assignedByName: z.string().nullable(),
  priority: z.enum(TASK_PRIORITIES),
  startDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  reminderAt: z.string().nullable(),
  status: z.enum(TASK_STATUSES),
  isOverdue: z.boolean(), // derived: due < today AND status not completed/cancelled
  startedDate: z.string().nullable(),
  completedDate: z.string().nullable(),
  completedAt: z.string().nullable(),
  completedBy: z.string().uuid().nullable(),
  completedByName: z.string().nullable(),
  completionRemark: z.string().nullable(),
  createdDate: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(), // "Last Update" column
  linkedRef: taskLinkedRefSchema.nullable(),
  isUnread: z.boolean(), // unread by the requesting user (assignee, !viewed, open)
  attachmentCount: z.number().int().nonnegative(),
  commentCount: z.number().int().nonnegative(),
  permissions: taskPermissionsSchema,
});
export type TaskRow = z.infer<typeof taskRowSchema>;

export const taskDetailSchema = taskRowSchema.extend({
  comments: z.array(taskCommentSchema),
  attachments: z.array(taskAttachmentSchema),
  history: z.array(taskHistoryEntrySchema),
});
export type TaskDetail = z.infer<typeof taskDetailSchema>;

export const taskStatusCountsSchema = z.object({
  todo: z.number().int().nonnegative(),
  in_progress: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(),
});
export type TaskStatusCounts = z.infer<typeof taskStatusCountsSchema>;

// Tab counters — open (not completed / cancelled) tasks per view. `all` is
// null for non-admins (the tab is not offered, and the API refuses view=all).
export const taskViewCountsSchema = z.object({
  inbox: z.number().int().nonnegative(),
  outbox: z.number().int().nonnegative(),
  todo: z.number().int().nonnegative(),
  all: z.number().int().nonnegative().nullable(),
});
export type TaskViewCounts = z.infer<typeof taskViewCountsSchema>;

export const listTasksResponseSchema = z.object({
  tasks: z.array(taskRowSchema),
  counts: taskStatusCountsSchema, // KPI cards — over the selected view (before row filters)
  viewCounts: taskViewCountsSchema,
  unreadCount: z.number().int().nonnegative(),
  isAdmin: z.boolean(),
});
export type ListTasksResponse = z.infer<typeof listTasksResponseSchema>;

// User option for the assignee / person dropdowns (active users).
export const taskUserOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  role: z.string().nullable(),
  mainDept: z.string().nullable(),
});
export type TaskUserOption = z.infer<typeof taskUserOptionSchema>;
