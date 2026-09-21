// Task Board helpers shared by service.ts (ADR-176): the per-task
// permission matrix, the visibility rule, the derived overdue flag, the
// row → TaskRow read model, and the append-only task_history writer.
//
// ONE permission helper (`permsFor`) feeds both the `permissions` block on
// every row the web receives AND the checks every mutation enforces, so the
// two can never disagree. RLS is bypassed (the API connects as postgres) —
// every rule here is the real one.

import {
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type TaskHistoryAction,
  type TaskHistoryEntry,
  type TaskLinkedRef,
  type TaskPermissions,
  type TaskPriority,
  type TaskRow,
  type TaskStatus,
  type TaskType,
} from '@innovic/shared';
import { and, asc, eq, isNull, or, type SQL } from 'drizzle-orm';
import { taskHistory, tasks, users } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';

export type TaskRecord = typeof tasks.$inferSelect;

export const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

export const isAdmin = (user: AuthContext): boolean => user.role === 'admin';

// Asia/Kolkata is a fixed UTC+5:30 offset (no DST) — server-side IST date.
export function istToday(): string {
  const now = new Date();
  return new Date(now.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// YYYY-MM-DD → YYYY-MM-DD + n days (pure string arithmetic on a UTC date).
export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const OPEN_STATUSES: readonly TaskStatus[] = ['todo', 'in_progress'];

export const isOpenStatus = (s: TaskStatus): boolean => s !== 'completed' && s !== 'cancelled';

// Overdue is DERIVED, never stored: due date passed and the task is still open.
export function isOverdueRow(r: Pick<TaskRecord, 'dueDate' | 'status'>, today: string): boolean {
  return isOpenStatus(r.status) && !!r.dueDate && r.dueDate < today;
}

// Unread = assigned to me, never opened, still open.
export function isUnreadRow(
  r: Pick<TaskRecord, 'assignedTo' | 'viewedAt' | 'status'>,
  userId: string,
): boolean {
  return r.assignedTo === userId && !r.viewedAt && isOpenStatus(r.status);
}

// ── Visibility ────────────────────────────────────────────────────────────
// Non-admin: I created it, it is assigned to me, or I assigned it.
// Admin: every task in the company.

export function canViewTask(
  r: Pick<TaskRecord, 'createdBy' | 'assignedTo' | 'assignedBy'>,
  user: AuthContext,
): boolean {
  if (isAdmin(user)) return true;
  return r.createdBy === user.id || r.assignedTo === user.id || r.assignedBy === user.id;
}

// SQL form of canViewTask, used by list queries. Always company + soft-delete.
export function visibleTasksWhere(companyId: string, user: AuthContext): SQL {
  const base = and(eq(tasks.companyId, companyId), isNull(tasks.deletedAt));
  if (isAdmin(user)) return base as SQL;
  return and(
    base,
    or(eq(tasks.createdBy, user.id), eq(tasks.assignedTo, user.id), eq(tasks.assignedBy, user.id)),
  ) as SQL;
}

// ── Permissions ───────────────────────────────────────────────────────────

export function permsFor(
  r: Pick<TaskRecord, 'createdBy' | 'assignedTo' | 'assignedBy'>,
  user: AuthContext,
): TaskPermissions {
  const admin = isAdmin(user);
  const creator = r.createdBy === user.id;
  const assignee = r.assignedTo === user.id;
  const view = canViewTask(r, user);
  const actor = view && (assignee || creator || admin);
  const owner = view && (creator || admin);
  return {
    canUpdateStatus: actor,
    canComplete: actor,
    canCancel: owner,
    canReassign: owner,
    canEdit: owner,
    canComment: view,
    canAttach: view && user.role !== 'viewer',
  };
}

// ── Names ─────────────────────────────────────────────────────────────────

export type NameMap = Map<string, string>;

export async function loadUserNames(tx: DbTransaction, companyId: string): Promise<NameMap> {
  const rows = await tx
    .select({ id: users.id, name: users.fullName })
    .from(users)
    .where(eq(users.companyId, companyId));
  return new Map(rows.map((r) => [r.id, r.name ?? '']));
}

export const nameOf = (names: NameMap, id: string | null | undefined): string | null =>
  id ? (names.get(id) ?? null) : null;

// ── Labels for history text ───────────────────────────────────────────────

export const priorityLabel = (p: TaskPriority): string => TASK_PRIORITY_LABELS[p];
export const statusLabel = (s: TaskStatus): string => TASK_STATUS_LABELS[s];
export const dateLabel = (d: string | null | undefined): string => d ?? '—';
export const isoOrNull = (d: Date | null | undefined): string | null =>
  d ? d.toISOString() : null;

// ── Read model ────────────────────────────────────────────────────────────

export function buildLinkedRef(r: TaskRecord): TaskLinkedRef | null {
  if (!r.linkedRefDisplay && !r.linkedRefType) return null;
  return {
    type: r.linkedRefType ?? '',
    id: r.linkedRefId ?? '',
    display: r.linkedRefDisplay ?? '',
    navPage: r.linkedRefNavPage ?? '',
  };
}

export interface RowContext {
  names: NameMap;
  user: AuthContext;
  today: string;
  attachmentCounts: Map<string, number>;
  commentCounts: Map<string, number>;
}

const asTaskType = (t: string): TaskType => (t === 'personal' ? 'personal' : 'assigned');

export function rowToTask(r: TaskRecord, ctx: RowContext): TaskRow {
  const { names } = ctx;
  return {
    id: r.id,
    code: r.code,
    taskType: asTaskType(r.taskType),
    title: r.title,
    description: r.description,
    createdBy: r.createdBy,
    createdByName: nameOf(names, r.createdBy),
    assignedTo: r.assignedTo,
    assignedToName: nameOf(names, r.assignedTo),
    assignedBy: r.assignedBy,
    assignedByName: nameOf(names, r.assignedBy),
    priority: r.priority,
    startDate: r.startDate,
    dueDate: r.dueDate,
    reminderAt: isoOrNull(r.reminderAt),
    status: r.status,
    isOverdue: isOverdueRow(r, ctx.today),
    startedDate: r.startedDate,
    completedDate: r.completedDate,
    completedAt: isoOrNull(r.completedAt),
    completedBy: r.completedBy,
    completedByName: nameOf(names, r.completedBy),
    completionRemark: r.completionRemark,
    createdDate: r.createdAt.toISOString().slice(0, 10),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    linkedRef: buildLinkedRef(r),
    isUnread: isUnreadRow(r, ctx.user.id),
    attachmentCount: ctx.attachmentCounts.get(r.id) ?? 0,
    commentCount: ctx.commentCounts.get(r.id) ?? 0,
    permissions: permsFor(r, ctx.user),
  };
}

// ── History ───────────────────────────────────────────────────────────────

export interface HistoryInput {
  action: TaskHistoryAction;
  fromValue?: string | null;
  toValue?: string | null;
  note?: string | null;
}

// Append one trail row inside the caller's transaction. created_by is
// ALWAYS the authenticated user — never read from the body.
export async function recordHistory(
  tx: DbTransaction,
  companyId: string,
  taskId: string,
  input: HistoryInput,
  user: AuthContext,
): Promise<void> {
  await tx.insert(taskHistory).values({
    companyId,
    taskId,
    action: input.action,
    fromValue: input.fromValue ?? null,
    toValue: input.toValue ?? null,
    note: input.note ?? null,
    createdBy: user.id,
  });
}

const asAction = (a: string): TaskHistoryAction => a as TaskHistoryAction;

export async function loadTaskHistory(
  tx: DbTransaction,
  taskId: string,
  names: NameMap,
): Promise<TaskHistoryEntry[]> {
  const rows = await tx
    .select()
    .from(taskHistory)
    .where(eq(taskHistory.taskId, taskId))
    .orderBy(asc(taskHistory.createdAt), asc(taskHistory.id));
  return rows.map((h) => ({
    id: h.id,
    action: asAction(h.action),
    fromValue: h.fromValue,
    toValue: h.toValue,
    note: h.note,
    by: names.get(h.createdBy) ?? '',
    at: h.createdAt.toISOString(),
  }));
}
