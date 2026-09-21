// Task Board service (migrations 0051 + 0139, ADR-176).
//
// One tasks table, four server-filtered views over it:
//   inbox  — assigned to me by someone else
//   outbox — I assigned to someone else
//   todo   — mine for me (personal to-dos AND tasks I assigned to myself)
//   all    — every company task (admin only, requireAdminRole)
// plus personal to-dos (TODO-NNNN, no assignee choice), an append-only
// history trail (task_history), remarks (task_comments) and attachments
// (file_registry.task_id). Overdue is DERIVED (due_date < IST today AND
// status not completed/cancelled), never stored.
//
// Who-am-I is never trusted from the browser: created_by / assigned_by /
// completed_by / comment author are always req.user. Visibility and the
// per-task permission matrix live in history.ts (permsFor) and are enforced
// HERE — the API connects as postgres, so RLS is not the guard.
//
// Status workflow: todo → in_progress → completed; cancelled from any open
// status. completed / cancelled are terminal.

import type {
  AddTaskCommentInput,
  CancelTaskInput,
  CompleteTaskInput,
  CreatePersonalTodoInput,
  CreateTaskInput,
  ListTasksQuery,
  ListTasksResponse,
  ReassignTaskInput,
  TaskAttachment,
  TaskAttachmentInput,
  TaskComment,
  TaskDetail,
  TaskHistoryEntry,
  TaskRow,
  TaskStatus,
  TaskStatusCounts,
  TaskType,
  TaskUserOption,
  UpdateTaskInput,
  UpdateTaskStatusInput,
} from '@innovic/shared';
import { and, asc, count, desc, eq, inArray, isNull, like, ne, or } from 'drizzle-orm';
import { fileRegistry, taskComments, tasks, userAccess, users } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireAdminRole } from '../../lib/auth';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import {
  type NameMap,
  OPEN_STATUSES,
  type RowContext,
  type TaskRecord,
  addDays,
  canViewTask,
  dateLabel,
  isAdmin,
  isOpenStatus,
  isOverdueRow,
  isUnreadRow,
  istToday,
  loadTaskHistory,
  loadUserNames,
  nameOf,
  permsFor,
  priorityLabel,
  recordHistory,
  requireCompany,
  rowToTask,
  statusLabel,
  visibleTasksWhere,
} from './history';

export { listRelatedOptions } from './related-options';

// ── Shared loaders ────────────────────────────────────────────────────────

// Per-task attachment / comment counts for a set of task ids — two grouped
// queries, never N+1.
async function loadCounts(
  tx: DbTransaction,
  companyId: string,
  ids: string[],
): Promise<Pick<RowContext, 'attachmentCounts' | 'commentCounts'>> {
  const attachmentCounts = new Map<string, number>();
  const commentCounts = new Map<string, number>();
  if (ids.length === 0) return { attachmentCounts, commentCounts };

  const att = await tx
    .select({ taskId: fileRegistry.taskId, n: count() })
    .from(fileRegistry)
    .where(
      and(
        eq(fileRegistry.companyId, companyId),
        inArray(fileRegistry.taskId, ids),
        isNull(fileRegistry.deletedAt),
      ),
    )
    .groupBy(fileRegistry.taskId);
  for (const r of att) if (r.taskId) attachmentCounts.set(r.taskId, Number(r.n));

  const com = await tx
    .select({ taskId: taskComments.taskId, n: count() })
    .from(taskComments)
    .where(
      and(
        eq(taskComments.companyId, companyId),
        inArray(taskComments.taskId, ids),
        isNull(taskComments.deletedAt),
      ),
    )
    .groupBy(taskComments.taskId);
  for (const r of com) commentCounts.set(r.taskId, Number(r.n));

  return { attachmentCounts, commentCounts };
}

// Load one task the caller may see; anything else is a 404 (existing
// convention — never reveal that a hidden task exists).
async function loadVisibleTask(
  tx: DbTransaction,
  id: string,
  companyId: string,
  user: AuthContext,
): Promise<TaskRecord> {
  const rows = await tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.companyId, companyId), isNull(tasks.deletedAt)))
    .limit(1);
  const t = rows[0];
  if (!t || !canViewTask(t, user)) throw new NotFoundError(`Task ${id} not found`);
  return t;
}

async function loadAssignee(
  tx: DbTransaction,
  companyId: string,
  assignedTo: string,
): Promise<{ id: string; name: string }> {
  const rows = await tx
    .select({ id: users.id, name: users.fullName, isActive: users.isActive })
    .from(users)
    .where(and(eq(users.id, assignedTo), eq(users.companyId, companyId), isNull(users.deletedAt)))
    .limit(1);
  const u = rows[0];
  if (!u || !u.isActive) throw new NotFoundError('Assignee not found in this company');
  return { id: u.id, name: u.name ?? '' };
}

async function loadAttachments(
  tx: DbTransaction,
  companyId: string,
  taskId: string,
): Promise<TaskAttachment[]> {
  const rows = await tx
    .select()
    .from(fileRegistry)
    .where(
      and(
        eq(fileRegistry.companyId, companyId),
        eq(fileRegistry.taskId, taskId),
        isNull(fileRegistry.deletedAt),
      ),
    )
    .orderBy(asc(fileRegistry.createdAt));
  return rows.map((f) => ({
    id: f.id,
    fileName: f.fileName,
    storagePath: f.storagePath,
    fileSize: f.fileSize,
    fileType: f.fileType,
    uploadedBy: f.uploadedByText ?? '',
    createdAt: f.createdAt.toISOString(),
  }));
}

async function loadComments(
  tx: DbTransaction,
  taskId: string,
  names: NameMap,
): Promise<TaskComment[]> {
  const rows = await tx
    .select()
    .from(taskComments)
    .where(and(eq(taskComments.taskId, taskId), isNull(taskComments.deletedAt)))
    .orderBy(asc(taskComments.createdAt));
  return rows.map((c) => ({
    id: c.id,
    byId: c.createdBy,
    by: names.get(c.createdBy) ?? '',
    date: c.commentDate,
    createdAt: c.createdAt.toISOString(),
    text: c.text,
  }));
}

async function getTaskInternal(
  tx: DbTransaction,
  id: string,
  companyId: string,
  user: AuthContext,
): Promise<TaskDetail> {
  const t = await loadVisibleTask(tx, id, companyId, user);
  const names = await loadUserNames(tx, companyId);
  const counts = await loadCounts(tx, companyId, [t.id]);
  const row = rowToTask(t, { names, user, today: istToday(), ...counts });
  // Sequential on purpose — one transaction, one connection.
  const comments = await loadComments(tx, t.id, names);
  const attachments = await loadAttachments(tx, companyId, t.id);
  const history = await loadTaskHistory(tx, t.id, names);
  return { ...row, comments, attachments, history };
}

// Register one already-uploaded file against the task + trail row.
async function registerAttachment(
  tx: DbTransaction,
  companyId: string,
  t: Pick<TaskRecord, 'id'>,
  input: TaskAttachmentInput,
  user: AuthContext,
  names: NameMap,
): Promise<void> {
  await tx.insert(fileRegistry).values({
    companyId,
    taskId: t.id,
    category: 'task',
    fileName: input.fileName,
    storagePath: input.storagePath,
    fileSize: input.fileSize ?? null,
    fileType: input.fileType ?? null,
    status: 'active',
    uploadedByText: user.fullName ?? nameOf(names, user.id) ?? user.email,
    createdBy: user.id,
    updatedBy: user.id,
  });
  await recordHistory(tx, companyId, t.id, { action: 'attachment', toValue: input.fileName }, user);
}

// ── List ──────────────────────────────────────────────────────────────────

export async function listTasks(
  query: ListTasksQuery,
  user: AuthContext,
): Promise<ListTasksResponse> {
  const companyId = requireCompany(user);
  if (query.view === 'all') requireAdminRole(user);
  const today = istToday();
  const me = user.id;

  return withUserContext(user, async (tx) => {
    const names = await loadUserNames(tx, companyId);

    const viewWhere =
      query.view === 'inbox'
        ? and(eq(tasks.assignedTo, me), ne(tasks.createdBy, me))
        : query.view === 'outbox'
          ? and(eq(tasks.createdBy, me), or(ne(tasks.assignedTo, me), isNull(tasks.assignedTo)))
          : query.view === 'todo'
            ? and(eq(tasks.createdBy, me), eq(tasks.assignedTo, me))
            : undefined; // all — admin, whole company

    const viewRows = await tx
      .select()
      .from(tasks)
      .where(and(visibleTasksWhere(companyId, user), viewWhere))
      .orderBy(desc(tasks.createdAt));

    // KPI cards over the whole view, BEFORE row filters. Overdue rows count
    // only as overdue; cancelled rows count in none.
    const counts: TaskStatusCounts = { todo: 0, in_progress: 0, completed: 0, overdue: 0 };
    for (const r of viewRows) {
      if (isOverdueRow(r, today)) counts.overdue += 1;
      else if (r.status === 'todo') counts.todo += 1;
      else if (r.status === 'in_progress') counts.in_progress += 1;
      else if (r.status === 'completed') counts.completed += 1;
    }

    // Tab counters + unread — one pass over my open tasks.
    const mine = await tx
      .select({
        createdBy: tasks.createdBy,
        assignedTo: tasks.assignedTo,
        viewedAt: tasks.viewedAt,
        status: tasks.status,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.companyId, companyId),
          isNull(tasks.deletedAt),
          inArray(tasks.status, [...OPEN_STATUSES]),
          or(eq(tasks.createdBy, me), eq(tasks.assignedTo, me)),
        ),
      );
    const viewCounts = { inbox: 0, outbox: 0, todo: 0, all: null as number | null };
    let unreadCount = 0;
    for (const r of mine) {
      if (r.assignedTo === me && r.createdBy !== me) viewCounts.inbox += 1;
      else if (r.createdBy === me && r.assignedTo !== me) viewCounts.outbox += 1;
      else if (r.createdBy === me && r.assignedTo === me) viewCounts.todo += 1;
      if (isUnreadRow(r, me)) unreadCount += 1;
    }
    if (isAdmin(user)) {
      const allOpen = await tx
        .select({ n: count() })
        .from(tasks)
        .where(
          and(
            eq(tasks.companyId, companyId),
            isNull(tasks.deletedAt),
            inArray(tasks.status, [...OPEN_STATUSES]),
          ),
        );
      viewCounts.all = Number(allOpen[0]?.n ?? 0);
    }

    // Row filters.
    let rows = viewRows;
    if (query.search) {
      const s = query.search.trim().toLowerCase();
      if (s) {
        rows = rows.filter((r) =>
          [r.code, r.title, r.description ?? '', r.linkedRefDisplay ?? ''].some((v) =>
            v.toLowerCase().includes(s),
          ),
        );
      }
    }
    if (query.status) rows = rows.filter((r) => r.status === query.status);
    if (query.priority) rows = rows.filter((r) => r.priority === query.priority);
    if (query.person) {
      const p = query.person;
      rows =
        query.view === 'inbox'
          ? rows.filter((r) => r.assignedBy === p)
          : rows.filter((r) => r.assignedTo === p);
    }
    if (query.assignedBy) rows = rows.filter((r) => r.assignedBy === query.assignedBy);
    if (query.due === 'today') rows = rows.filter((r) => r.dueDate === today);
    else if (query.due === 'week') {
      const end = addDays(today, 6);
      rows = rows.filter((r) => !!r.dueDate && r.dueDate >= today && r.dueDate <= end);
    } else if (query.due === 'overdue') rows = rows.filter((r) => isOverdueRow(r, today));
    if (query.dept && query.view === 'all') {
      const access = await tx
        .select({ userId: userAccess.userId, mainDept: userAccess.mainDept })
        .from(userAccess)
        .where(and(eq(userAccess.companyId, companyId), isNull(userAccess.deletedAt)));
      const deptOf = new Map(access.map((a) => [a.userId, a.mainDept]));
      rows = rows.filter((r) => !!r.assignedTo && deptOf.get(r.assignedTo) === query.dept);
    }

    const perTask = await loadCounts(
      tx,
      companyId,
      rows.map((r) => r.id),
    );
    const ctx: RowContext = { names, user, today, ...perTask };
    const mapped: TaskRow[] = rows.map((r) => rowToTask(r, ctx));

    return { tasks: mapped, counts, viewCounts, unreadCount, isAdmin: isAdmin(user) };
  });
}

// ── Read one ──────────────────────────────────────────────────────────────

export async function getTask(id: string, user: AuthContext): Promise<TaskDetail> {
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => getTaskInternal(tx, id, companyId, user));
}

export async function getTaskHistory(id: string, user: AuthContext): Promise<TaskHistoryEntry[]> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const t = await loadVisibleTask(tx, id, companyId, user);
    const names = await loadUserNames(tx, companyId);
    return loadTaskHistory(tx, t.id, names);
  });
}

// ── Numbering ─────────────────────────────────────────────────────────────
// TSK-NNNN for assigned tasks, TODO-NNNN for personal to-dos — separate
// series, each = max existing number under that prefix + 1. Soft-deleted
// rows still count so a number is never reused.

const PREFIX: Record<TaskType, string> = { assigned: 'TSK', personal: 'TODO' };

async function nextCode(tx: DbTransaction, companyId: string, type: TaskType): Promise<string> {
  const prefix = PREFIX[type];
  const rows = await tx
    .select({ code: tasks.code })
    .from(tasks)
    .where(and(eq(tasks.companyId, companyId), like(tasks.code, `${prefix}-%`)));
  let max = 0;
  for (const r of rows) {
    const m = Number(r.code.slice(prefix.length + 1).replace(/\D/g, '')) || 0;
    if (m > max) max = m;
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

export async function getNextTaskCode(
  user: AuthContext,
  type: TaskType = 'assigned',
): Promise<{ code: string }> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => ({ code: await nextCode(tx, companyId, type) }));
}

// ── Create ────────────────────────────────────────────────────────────────

// Assign Task — any authenticated active user. Assigning to yourself is
// allowed and simply lands in My To-Do; taskType stays 'assigned'.
// The read-only `viewer` role may look at its own tasks but never write —
// same as every other module.
function requireNotViewer(user: AuthContext): void {
  if (user.role === 'viewer') throw new AuthorizationError('Viewers cannot change tasks');
}

export async function createTask(input: CreateTaskInput, user: AuthContext): Promise<TaskDetail> {
  requireNotViewer(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const assignee = await loadAssignee(tx, companyId, input.assignedTo);
    const code = await nextCode(tx, companyId, 'assigned');
    const lr = input.linkedRef ?? null;
    const inserted = await tx
      .insert(tasks)
      .values({
        companyId,
        code,
        taskType: 'assigned',
        title: input.title,
        description: input.description ?? null,
        assignedTo: assignee.id,
        assignedBy: user.id,
        priority: input.priority,
        startDate: input.startDate ?? null,
        dueDate: input.dueDate,
        status: 'todo',
        // You have seen the task you just wrote for yourself.
        viewedAt: assignee.id === user.id ? new Date() : null,
        linkedRefType: lr?.type ?? null,
        linkedRefId: lr?.id ?? null,
        linkedRefDisplay: lr?.display ?? null,
        linkedRefNavPage: lr?.navPage ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const header = inserted[0];
    if (!header) throw new Error('Insert failed');

    await recordHistory(
      tx,
      companyId,
      header.id,
      { action: 'created', toValue: assignee.name },
      user,
    );
    const names = await loadUserNames(tx, companyId);
    for (const a of input.attachments ?? []) {
      await registerAttachment(tx, companyId, header, a, user, names);
    }

    await emitActivityLog(
      tx,
      {
        action: 'CREATE',
        entity: 'Task',
        detail: `Assigned ${code} to ${assignee.name}${lr ? ` [${lr.display}]` : ''}`,
        refId: code,
      },
      companyId,
      user,
    );
    return getTaskInternal(tx, header.id, companyId, user);
  });
}

// My To-Do — assignee is forced to the caller; due date and reminder are
// optional. The reminder is stored only (no reminder engine exists).
export async function createPersonalTodo(
  input: CreatePersonalTodoInput,
  user: AuthContext,
): Promise<TaskDetail> {
  requireNotViewer(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const code = await nextCode(tx, companyId, 'personal');
    const inserted = await tx
      .insert(tasks)
      .values({
        companyId,
        code,
        taskType: 'personal',
        title: input.title,
        description: input.description ?? null,
        assignedTo: user.id,
        assignedBy: user.id,
        priority: input.priority,
        dueDate: input.dueDate ?? null,
        reminderAt: input.reminderAt ? new Date(input.reminderAt) : null,
        status: 'todo',
        viewedAt: new Date(), // own to-do — never "unread" to its author
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const header = inserted[0];
    if (!header) throw new Error('Insert failed');

    await recordHistory(
      tx,
      companyId,
      header.id,
      { action: 'created', toValue: 'Personal to-do' },
      user,
    );
    await emitActivityLog(
      tx,
      { action: 'CREATE', entity: 'Task', detail: `Added to-do ${code}`, refId: code },
      companyId,
      user,
    );
    return getTaskInternal(tx, header.id, companyId, user);
  });
}

// ── Edit details (creator / admin) ────────────────────────────────────────

export async function updateTask(
  id: string,
  input: UpdateTaskInput,
  user: AuthContext,
): Promise<TaskDetail> {
  requireNotViewer(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const t = await loadVisibleTask(tx, id, companyId, user);
    if (!permsFor(t, user).canEdit) {
      throw new AuthorizationError('Only the task creator or an admin can edit this task');
    }
    if (t.taskType === 'assigned' && input.dueDate === null) {
      throw new ValidationError('An assigned task must have a due date');
    }

    const updates: Partial<typeof tasks.$inferInsert> = {};
    let edited = false;
    if (input.title !== undefined && input.title !== t.title) {
      updates.title = input.title;
      edited = true;
    }
    if (input.description !== undefined && input.description !== t.description) {
      updates.description = input.description;
      edited = true;
    }
    if (input.startDate !== undefined && input.startDate !== t.startDate) {
      updates.startDate = input.startDate;
      edited = true;
    }
    if (input.reminderAt !== undefined) {
      const next = input.reminderAt ? new Date(input.reminderAt) : null;
      if ((next?.getTime() ?? null) !== (t.reminderAt?.getTime() ?? null)) {
        updates.reminderAt = next;
        edited = true;
      }
    }
    if (input.linkedRef !== undefined) {
      const lr = input.linkedRef;
      const changed =
        (lr?.type ?? null) !== t.linkedRefType ||
        (lr?.id ?? null) !== t.linkedRefId ||
        (lr?.display ?? null) !== t.linkedRefDisplay ||
        (lr?.navPage ?? null) !== t.linkedRefNavPage;
      if (changed) {
        updates.linkedRefType = lr?.type ?? null;
        updates.linkedRefId = lr?.id ?? null;
        updates.linkedRefDisplay = lr?.display ?? null;
        updates.linkedRefNavPage = lr?.navPage ?? null;
        edited = true;
      }
    }
    const priorityChanged = input.priority !== undefined && input.priority !== t.priority;
    const dueChanged = input.dueDate !== undefined && input.dueDate !== t.dueDate;
    if (priorityChanged && input.priority !== undefined) updates.priority = input.priority;
    if (dueChanged && input.dueDate !== undefined) updates.dueDate = input.dueDate;

    if (Object.keys(updates).length === 0) return getTaskInternal(tx, id, companyId, user);

    await tx
      .update(tasks)
      .set({ ...updates, updatedBy: user.id, updatedAt: new Date() })
      .where(eq(tasks.id, id));

    if (priorityChanged && input.priority) {
      await recordHistory(
        tx,
        companyId,
        id,
        {
          action: 'priority_changed',
          fromValue: priorityLabel(t.priority),
          toValue: priorityLabel(input.priority),
        },
        user,
      );
    }
    if (dueChanged) {
      await recordHistory(
        tx,
        companyId,
        id,
        {
          action: 'due_date_changed',
          fromValue: dateLabel(t.dueDate),
          toValue: dateLabel(input.dueDate),
        },
        user,
      );
    }
    if (edited) await recordHistory(tx, companyId, id, { action: 'edited' }, user);

    await emitActivityLog(
      tx,
      { action: 'UPDATE', entity: 'Task', detail: `${t.code} details edited`, refId: t.code },
      companyId,
      user,
    );
    return getTaskInternal(tx, id, companyId, user);
  });
}

// ── Status workflow ───────────────────────────────────────────────────────

interface TransitionOptions {
  remark?: string | undefined; // completion remark
  reason?: string | undefined; // cancel reason
  comment?: string | undefined; // progress comment (Update Status modal)
  attachments?: TaskAttachmentInput[] | undefined;
}

// The one place a status changes. Enforces the workflow + permission matrix,
// stamps the legacy date columns, writes every trail row.
async function addProgressComment(
  tx: DbTransaction,
  companyId: string,
  taskId: string,
  text: string,
  today: string,
  user: AuthContext,
): Promise<void> {
  await tx.insert(taskComments).values({
    companyId,
    taskId,
    commentDate: today,
    text,
    createdBy: user.id,
    updatedBy: user.id,
  });
  await recordHistory(tx, companyId, taskId, { action: 'comment', note: text }, user);
}

async function transitionStatus(
  tx: DbTransaction,
  t: TaskRecord,
  target: TaskStatus,
  opts: TransitionOptions,
  companyId: string,
  user: AuthContext,
): Promise<void> {
  const perms = permsFor(t, user);
  if (target === 'cancelled') {
    if (!perms.canCancel) {
      throw new AuthorizationError('Only the task creator or an admin can cancel this task');
    }
  } else if (!perms.canUpdateStatus) {
    throw new AuthorizationError('Only the assignee, the creator or an admin can update this task');
  }
  if (!isOpenStatus(t.status)) {
    throw new ConflictError(`Task ${t.code} is already ${statusLabel(t.status).toLowerCase()}`);
  }
  const today = istToday();
  const now = new Date();

  // Same status + a remark = a progress note (the Update Status modal opens
  // on the current status; the old board accepted exactly this). Same status
  // and nothing to say is a no-op, not an error.
  if (t.status === target) {
    if (opts.comment) await addProgressComment(tx, companyId, t.id, opts.comment, today, user);
    return;
  }

  const updates: Partial<typeof tasks.$inferInsert> = {
    status: target,
    updatedBy: user.id,
    updatedAt: now,
  };
  if (target === 'in_progress' && !t.startedDate) updates.startedDate = today;
  if (target === 'completed') {
    updates.completedAt = now;
    updates.completedBy = user.id;
    updates.completedDate = today; // legacy column kept in sync
    updates.completionRemark = opts.remark ?? null;
  }
  await tx.update(tasks).set(updates).where(eq(tasks.id, t.id));

  await recordHistory(
    tx,
    companyId,
    t.id,
    {
      action: 'status_changed',
      fromValue: statusLabel(t.status),
      toValue: statusLabel(target),
      note: opts.comment ?? null,
    },
    user,
  );
  if (target === 'completed') {
    await recordHistory(
      tx,
      companyId,
      t.id,
      { action: 'completed', note: opts.remark ?? null },
      user,
    );
  } else if (target === 'cancelled') {
    await recordHistory(
      tx,
      companyId,
      t.id,
      { action: 'cancelled', note: opts.reason ?? null },
      user,
    );
  }

  if (opts.comment) await addProgressComment(tx, companyId, t.id, opts.comment, today, user);
  if (opts.attachments?.length) {
    const names = await loadUserNames(tx, companyId);
    for (const a of opts.attachments) await registerAttachment(tx, companyId, t, a, user, names);
  }

  await emitActivityLog(
    tx,
    { action: 'UPDATE', entity: 'Task', detail: `${t.code} → ${target}`, refId: t.code },
    companyId,
    user,
  );
}

export async function updateTaskStatus(
  id: string,
  input: UpdateTaskStatusInput,
  user: AuthContext,
): Promise<TaskDetail> {
  requireNotViewer(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const t = await loadVisibleTask(tx, id, companyId, user);
    await transitionStatus(tx, t, input.status, { comment: input.comment }, companyId, user);
    return getTaskInternal(tx, id, companyId, user);
  });
}

export async function completeTask(
  id: string,
  input: CompleteTaskInput,
  user: AuthContext,
): Promise<TaskDetail> {
  requireNotViewer(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const t = await loadVisibleTask(tx, id, companyId, user);
    await transitionStatus(
      tx,
      t,
      'completed',
      { remark: input.remark, attachments: input.attachments },
      companyId,
      user,
    );
    return getTaskInternal(tx, id, companyId, user);
  });
}

export async function cancelTask(
  id: string,
  input: CancelTaskInput,
  user: AuthContext,
): Promise<TaskDetail> {
  requireNotViewer(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const t = await loadVisibleTask(tx, id, companyId, user);
    await transitionStatus(tx, t, 'cancelled', { reason: input.reason }, companyId, user);
    return getTaskInternal(tx, id, companyId, user);
  });
}

// ── Reassign (creator / admin) ────────────────────────────────────────────

export async function reassignTask(
  id: string,
  input: ReassignTaskInput,
  user: AuthContext,
): Promise<TaskDetail> {
  requireNotViewer(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const t = await loadVisibleTask(tx, id, companyId, user);
    if (!permsFor(t, user).canReassign) {
      throw new AuthorizationError('Only the task creator or an admin can reassign this task');
    }
    if (!isOpenStatus(t.status)) {
      throw new ConflictError(`Task ${t.code} is already ${statusLabel(t.status).toLowerCase()}`);
    }
    if (t.taskType === 'personal') {
      throw new ConflictError('A personal to-do cannot be reassigned — assign a task instead');
    }
    if (t.assignedTo === input.assignedTo) {
      throw new ConflictError('Task is already assigned to that user');
    }
    const assignee = await loadAssignee(tx, companyId, input.assignedTo);
    const names = await loadUserNames(tx, companyId);

    await tx
      .update(tasks)
      .set({
        assignedTo: assignee.id,
        assignedBy: user.id,
        // The new assignee has not seen it yet — unless it is me.
        viewedAt: assignee.id === user.id ? new Date() : null,
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, id));

    await recordHistory(
      tx,
      companyId,
      id,
      {
        action: 'reassigned',
        fromValue: nameOf(names, t.assignedTo) ?? '—',
        toValue: assignee.name,
        note: input.note ?? null,
      },
      user,
    );
    await emitActivityLog(
      tx,
      {
        action: 'UPDATE',
        entity: 'Task',
        detail: `${t.code} reassigned to ${assignee.name}`,
        refId: t.code,
      },
      companyId,
      user,
    );
    return getTaskInternal(tx, id, companyId, user);
  });
}

// ── Remarks + attachments ─────────────────────────────────────────────────

export async function addTaskComment(
  id: string,
  input: AddTaskCommentInput,
  user: AuthContext,
): Promise<TaskDetail> {
  requireNotViewer(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const t = await loadVisibleTask(tx, id, companyId, user); // canComment = can view
    await tx.insert(taskComments).values({
      companyId,
      taskId: t.id,
      commentDate: istToday(),
      text: input.text,
      createdBy: user.id,
      updatedBy: user.id,
    });
    await recordHistory(tx, companyId, t.id, { action: 'comment', note: input.text }, user);
    return getTaskInternal(tx, id, companyId, user);
  });
}

// The browser has already put the bytes in Storage (folder 'task-docs');
// this only records the metadata — same shape as JWSO documents.
export async function addTaskAttachment(
  id: string,
  input: TaskAttachmentInput,
  user: AuthContext,
): Promise<TaskDetail> {
  const companyId = requireCompany(user);
  requireNotViewer(user);
  return withUserContext(user, async (tx) => {
    const t = await loadVisibleTask(tx, id, companyId, user);
    if (!permsFor(t, user).canAttach) throw new AuthorizationError('Cannot attach to this task');
    const names = await loadUserNames(tx, companyId);
    await registerAttachment(tx, companyId, t, input, user, names);
    return getTaskInternal(tx, id, companyId, user);
  });
}

// ── Viewed / options ──────────────────────────────────────────────────────

// Stamp viewed_at for the current user's unread open tasks (called when the
// assignee opens their Inbox).
export async function markTasksViewed(user: AuthContext): Promise<{ updated: number }> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const updated = await tx
      .update(tasks)
      .set({ viewedAt: new Date() })
      .where(
        and(
          eq(tasks.companyId, companyId),
          eq(tasks.assignedTo, user.id),
          isNull(tasks.viewedAt),
          isNull(tasks.deletedAt),
        ),
      )
      .returning({ id: tasks.id });
    return { updated: updated.length };
  });
}

// Active users of the company + their Access Control main department.
export async function listUserOptions(user: AuthContext): Promise<TaskUserOption[]> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select({
        id: users.id,
        name: users.fullName,
        role: users.role,
        isActive: users.isActive,
        mainDept: userAccess.mainDept,
      })
      .from(users)
      .leftJoin(
        userAccess,
        and(
          eq(userAccess.userId, users.id),
          eq(userAccess.companyId, companyId),
          isNull(userAccess.deletedAt),
        ),
      )
      .where(and(eq(users.companyId, companyId), isNull(users.deletedAt)))
      .orderBy(asc(users.fullName));
    return rows
      .filter((r) => r.isActive)
      .map((r) => ({ id: r.id, name: r.name ?? '', role: r.role, mainDept: r.mainDept ?? null }));
  });
}
