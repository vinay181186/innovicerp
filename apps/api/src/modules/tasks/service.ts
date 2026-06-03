// Task Board service (migration 0051). Mirror of legacy renderTaskBoard
// (HTML L14255) + _addTask / _assignTaskFromContext / _updateTaskStatus /
// _viewTask / _markTasksViewed. Overdue is DERIVED (status != completed &&
// due_date < today), never stored.

import type {
  CreateTaskInput,
  ListTasksResponse,
  TaskComment,
  TaskDetail,
  TaskLinkedRef,
  TaskRow,
  TaskStatus,
  TaskStatusCounts,
  TaskUserOption,
  UpdateTaskStatusInput,
} from '@innovic/shared';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { taskComments, tasks, users } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireWriteRole } from '../../lib/auth';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

const isWriter = (user: AuthContext): boolean =>
  user.role === 'admin' || user.role === 'manager';

// Asia/Kolkata is a fixed UTC+5:30 offset (no DST) — server-side IST date.
function istToday(): string {
  const now = new Date();
  return new Date(now.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function loadUserNames(
  tx: DbTransaction,
  companyId: string,
): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: users.id, name: users.fullName })
    .from(users)
    .where(eq(users.companyId, companyId));
  return new Map(rows.map((r) => [r.id, r.name ?? '']));
}

function buildLinkedRef(r: typeof tasks.$inferSelect): TaskLinkedRef | null {
  if (!r.linkedRefDisplay && !r.linkedRefType) return null;
  return {
    type: r.linkedRefType ?? '',
    id: r.linkedRefId ?? '',
    display: r.linkedRefDisplay ?? '',
    navPage: r.linkedRefNavPage ?? '',
  };
}

function rowToTask(
  r: typeof tasks.$inferSelect,
  names: Map<string, string>,
  userId: string,
  today: string,
): TaskRow {
  const isOverdue = r.status !== 'completed' && !!r.dueDate && r.dueDate < today;
  const isUnread = r.assignedTo === userId && !r.viewedAt && r.status !== 'completed';
  return {
    id: r.id,
    code: r.code,
    title: r.title,
    description: r.description,
    assignedTo: r.assignedTo,
    assignedToName: r.assignedTo ? (names.get(r.assignedTo) ?? null) : null,
    assignedBy: r.assignedBy,
    assignedByName: r.assignedBy ? (names.get(r.assignedBy) ?? null) : null,
    priority: r.priority,
    dueDate: r.dueDate,
    status: r.status,
    isOverdue,
    startedDate: r.startedDate,
    completedDate: r.completedDate,
    createdDate: r.createdAt.toISOString().slice(0, 10),
    linkedRef: buildLinkedRef(r),
    isUnread,
  };
}

export interface TaskFilters {
  assignedTo?: string | undefined;
  status?: TaskStatus | undefined;
  priority?: 'high' | 'medium' | 'low' | undefined;
}

export async function listTasks(
  filters: TaskFilters,
  user: AuthContext,
): Promise<ListTasksResponse> {
  const companyId = requireCompany(user);
  const today = istToday();
  return withUserContext(user, async (tx) => {
    const names = await loadUserNames(tx, companyId);
    const allRows = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.companyId, companyId), isNull(tasks.deletedAt)))
      .orderBy(desc(tasks.createdAt));

    const mapped = allRows.map((r) => rowToTask(r, names, user.id, today));

    // Counts over ALL tasks (legacy L14270): overdue rows count ONLY as overdue.
    const counts: TaskStatusCounts = { todo: 0, in_progress: 0, completed: 0, overdue: 0 };
    for (const t of mapped) {
      if (t.isOverdue) counts.overdue += 1;
      else if (t.status === 'todo') counts.todo += 1;
      else if (t.status === 'in_progress') counts.in_progress += 1;
      else if (t.status === 'completed') counts.completed += 1;
    }
    const unreadCount = mapped.filter((t) => t.isUnread).length;

    // Row filters (legacy client-side filters).
    let rows = mapped;
    if (filters.assignedTo) rows = rows.filter((t) => t.assignedTo === filters.assignedTo);
    if (filters.status) rows = rows.filter((t) => t.status === filters.status);
    if (filters.priority) rows = rows.filter((t) => t.priority === filters.priority);

    return { tasks: rows, counts, unreadCount };
  });
}

async function getTaskInternal(
  tx: DbTransaction,
  id: string,
  companyId: string,
  user: AuthContext,
  names: Map<string, string>,
): Promise<TaskDetail> {
  const rows = await tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.companyId, companyId), isNull(tasks.deletedAt)))
    .limit(1);
  const t = rows[0];
  if (!t) throw new NotFoundError(`Task ${id} not found`);

  const commentRows = await tx
    .select()
    .from(taskComments)
    .where(and(eq(taskComments.taskId, id), isNull(taskComments.deletedAt)))
    .orderBy(asc(taskComments.createdAt));

  const comments: TaskComment[] = commentRows.map((c) => ({
    id: c.id,
    by: names.get(c.createdBy) ?? '',
    date: c.commentDate,
    text: c.text,
  }));

  return { ...rowToTask(t, names, user.id, istToday()), comments };
}

export async function getTask(id: string, user: AuthContext): Promise<TaskDetail> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const names = await loadUserNames(tx, companyId);
    return getTaskInternal(tx, id, companyId, user, names);
  });
}

async function nextCode(tx: DbTransaction, companyId: string): Promise<string> {
  const rows = await tx
    .select({ code: tasks.code })
    .from(tasks)
    .where(eq(tasks.companyId, companyId));
  let max = 0;
  for (const r of rows) {
    const m = Number((r.code || '').replace(/\D/g, '')) || 0;
    if (m > max) max = m;
  }
  return `TSK-${String(max + 1).padStart(4, '0')}`;
}

export async function createTask(input: CreateTaskInput, user: AuthContext): Promise<TaskDetail> {
  requireWriteRole(user); // admin/manager assign tasks
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // Validate the assignee belongs to the company.
    const assignee = await tx
      .select({ id: users.id, name: users.fullName })
      .from(users)
      .where(and(eq(users.id, input.assignedTo), eq(users.companyId, companyId)))
      .limit(1);
    if (!assignee[0]) throw new NotFoundError('Assignee not found in this company');

    const code = await nextCode(tx, companyId);
    const lr = input.linkedRef ?? null;
    const inserted = await tx
      .insert(tasks)
      .values({
        companyId,
        code,
        title: input.title,
        description: input.description ?? null,
        assignedTo: input.assignedTo,
        assignedBy: user.id,
        priority: input.priority,
        dueDate: input.dueDate,
        status: 'todo',
        linkedRefType: lr?.type ?? null,
        linkedRefId: lr?.id ?? null,
        linkedRefDisplay: lr?.display ?? null,
        linkedRefNavPage: lr?.navPage ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const header = inserted[0]!;

    await emitActivityLog(
      tx,
      {
        action: 'CREATE',
        entity: 'Task',
        detail: `Assigned ${code} to ${assignee[0].name ?? ''}${lr ? ` [${lr.display}]` : ''}`,
        refId: code,
      },
      companyId,
      user,
    );

    const names = await loadUserNames(tx, companyId);
    return getTaskInternal(tx, header.id, companyId, user, names);
  });
}

export async function updateTaskStatus(
  id: string,
  input: UpdateTaskStatusInput,
  user: AuthContext,
): Promise<TaskDetail> {
  const companyId = requireCompany(user);
  const today = istToday();

  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.companyId, companyId), isNull(tasks.deletedAt)))
      .limit(1);
    const t = rows[0];
    if (!t) throw new NotFoundError(`Task ${id} not found`);

    // Assignee or admin/manager may update.
    if (!isWriter(user) && t.assignedTo !== user.id) {
      throw new AuthorizationError('Only the assignee or a manager can update this task');
    }

    const updates: Partial<typeof tasks.$inferInsert> = {
      status: input.status,
      updatedBy: user.id,
      updatedAt: new Date(),
    };
    if (input.status === 'in_progress' && !t.startedDate) updates.startedDate = today;
    if (input.status === 'completed' && !t.completedDate) updates.completedDate = today;
    await tx.update(tasks).set(updates).where(eq(tasks.id, id));

    if (input.comment) {
      await tx.insert(taskComments).values({
        companyId,
        taskId: id,
        commentDate: today,
        text: input.comment,
        createdBy: user.id,
        updatedBy: user.id,
      });
    }

    await emitActivityLog(
      tx,
      { action: 'UPDATE', entity: 'Task', detail: `${t.code} → ${input.status}`, refId: t.code },
      companyId,
      user,
    );

    const names = await loadUserNames(tx, companyId);
    return getTaskInternal(tx, id, companyId, user, names);
  });
}

// Stamp viewed_at for the current user's unread, non-completed tasks. Mirror
// of legacy _markTasksViewed (called when the assignee opens their work view).
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
    // Note: completed tasks with null viewed_at are rare (status set without a
    // prior view); harmless to stamp. Legacy excludes them; we keep it simple.
    return { updated: updated.length };
  });
}

export async function listUserOptions(user: AuthContext): Promise<TaskUserOption[]> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select({ id: users.id, name: users.fullName, role: users.role, isActive: users.isActive })
      .from(users)
      .where(and(eq(users.companyId, companyId), isNull(users.deletedAt)))
      .orderBy(asc(users.fullName));
    return rows
      .filter((r) => r.isActive)
      .map((r) => ({ id: r.id, name: r.name ?? '', role: r.role }));
  });
}
