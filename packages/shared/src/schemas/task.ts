// Task Board shared schemas (migration 0051). Mirror of legacy
// renderTaskBoard (HTML L14255) + _addTask / _assignTaskFromContext /
// _updateTaskStatus / _viewTask. Each task's comments live in their own rows
// (task_comments) — no embedded JSON array (CLAUDE.md anti-pattern #1).

import { z } from 'zod';
import { TASK_PRIORITIES } from '../enums/task-priority';
import { TASK_STATUSES } from '../enums/task-status';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// A contextual link to a source record (PR/PO/SO/NC/CAPA/JC/GRN/DESIGN).
export const taskLinkedRefSchema = z.object({
  type: z.string().max(32),
  id: z.string().max(128),
  display: z.string().max(255),
  navPage: z.string().max(64),
});
export type TaskLinkedRef = z.infer<typeof taskLinkedRefSchema>;

// ── Create (standalone "Assign Task" + contextual assign) ──
export const createTaskInputSchema = z.object({
  title: z.string().min(1, 'Title required').max(255),
  description: z.string().max(2000).optional(),
  assignedTo: z.string().uuid(),
  priority: z.enum(TASK_PRIORITIES).default('medium'),
  dueDate: dateStr,
  linkedRef: taskLinkedRefSchema.nullish(),
});
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;

// ── Update status (+ optional progress comment) ──
// Only the three user-facing statuses are settable (legacy dropdown);
// 'cancelled' is admin-tooling only and not exposed here.
export const updateTaskStatusInputSchema = z.object({
  status: z.enum(['todo', 'in_progress', 'completed']),
  comment: z.string().max(2000).optional(),
});
export type UpdateTaskStatusInput = z.infer<typeof updateTaskStatusInputSchema>;

// ── Read models ──
export const taskCommentSchema = z.object({
  id: z.string().uuid(),
  by: z.string(), // author full name
  date: z.string(),
  text: z.string(),
});
export type TaskComment = z.infer<typeof taskCommentSchema>;

export const taskRowSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  assignedTo: z.string().uuid().nullable(),
  assignedToName: z.string().nullable(),
  assignedBy: z.string().uuid().nullable(),
  assignedByName: z.string().nullable(),
  priority: z.enum(TASK_PRIORITIES),
  dueDate: z.string(),
  status: z.enum(TASK_STATUSES),
  isOverdue: z.boolean(),
  startedDate: z.string().nullable(),
  completedDate: z.string().nullable(),
  createdDate: z.string(),
  linkedRef: taskLinkedRefSchema.nullable(),
  isUnread: z.boolean(), // unread by the requesting user (assignee, !viewed, !completed)
});
export type TaskRow = z.infer<typeof taskRowSchema>;

export const taskDetailSchema = taskRowSchema.extend({
  comments: z.array(taskCommentSchema),
});
export type TaskDetail = z.infer<typeof taskDetailSchema>;

export const taskStatusCountsSchema = z.object({
  todo: z.number().int().nonnegative(),
  in_progress: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(),
});
export type TaskStatusCounts = z.infer<typeof taskStatusCountsSchema>;

export const listTasksResponseSchema = z.object({
  tasks: z.array(taskRowSchema),
  counts: taskStatusCountsSchema,
  unreadCount: z.number().int().nonnegative(),
});
export type ListTasksResponse = z.infer<typeof listTasksResponseSchema>;

// User option for the assignee dropdown (active users).
export const taskUserOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  role: z.string().nullable(),
});
export type TaskUserOption = z.infer<typeof taskUserOptionSchema>;
