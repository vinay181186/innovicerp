// ADR-309 (owner 2026-11-18) — task notices: the ONE writer of task_notices.
// Every task assign / complete / cancel calls recordTaskNotices inside the
// same transaction as the task write, so a notice exists exactly when the
// task change committed. One row feeds the bell (dashboard/personal/
// task-notes.ts) AND the Windows pop-up (push/sender.ts).
//
// Who gets one (owner rules, packages/shared task-notices.ts):
//   task_assigned  → the assignee
//   task_completed → assigned_by AND created_by (deduped)
//   task_cancelled → the assignee
//   never the person who did it; never a private to-do (isPrivateTodo) for
//   completed / cancelled. Not applied to task_assigned: the actor rule
//   already drops self-assign and own to-dos, and a task reassigned BACK to
//   its creator looks like a private to-do but is not one.
//   Never someone whose Task Board is hidden (ADR-257) — the same
//   personHolds('taskboard_view', 'view') rule the bell applies, checked
//   here once so bell and pop-up always agree.
// A duplicate (same task, kind, recipient, event time) is ignored
// (ON CONFLICT DO NOTHING on task_notices_event_uq).

import type { TaskNoticeKind } from '@innovic/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { taskNotices, userAccess, users } from '../../db/schema';
import { afterCommit } from '../../db/after-commit';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { personHolds } from '../access-control/users-with-right';
import { kickPushSender } from '../push/kick';
import { isPrivateTodo } from './history';

export interface TaskNoticeParties {
  kind: TaskNoticeKind;
  assignedTo: string | null;
  assignedBy: string | null;
  createdBy: string | null;
  actorId: string | null;
}

/** Who is told about one task event. Pure (the Task Board check is the
 *  caller's — recordTaskNotices). */
export function taskNoticeRecipients(p: TaskNoticeParties): string[] {
  if (
    p.kind !== 'task_assigned' &&
    isPrivateTodo({ createdBy: p.createdBy ?? '', assignedTo: p.assignedTo })
  ) {
    return [];
  }
  const raw = p.kind === 'task_completed' ? [p.assignedBy, p.createdBy] : [p.assignedTo];
  const out: string[] = [];
  for (const id of raw) {
    if (!id || id === p.actorId || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

export interface RecordTaskNoticesInput {
  companyId: string;
  task: {
    id: string;
    assignedTo: string | null;
    assignedBy: string | null;
    createdBy: string | null;
  };
  kind: TaskNoticeKind;
  actorId: string;
  eventAt: Date;
}

/** Of these people, the ones whose Task Board opens — ONE query for all. */
async function withTaskBoard(
  tx: DbTransaction,
  companyId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await tx
    .select({
      id: users.id,
      role: users.role,
      acFullAccess: userAccess.fullAccess,
      acAuditor: userAccess.auditor,
      acDepartments: userAccess.departments,
      acForms: userAccess.forms,
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
    .where(
      and(inArray(users.id, [...ids]), eq(users.companyId, companyId), isNull(users.deletedAt)),
    );
  return new Set(rows.filter((r) => personHolds(r, 'taskboard_view', 'view')).map((r) => r.id));
}

/** Insert the notices for one or many task events in the caller's
 *  transaction — one recipient read and ONE multi-row INSERT for all of them
 *  — then wake the push sender. Returns how many rows were written. */
export async function recordTaskNotices(
  tx: DbTransaction,
  input: RecordTaskNoticesInput | readonly RecordTaskNoticesInput[],
  user: AuthContext,
): Promise<number> {
  const events: readonly RecordTaskNoticesInput[] = Array.isArray(input)
    ? input
    : [input as RecordTaskNoticesInput];
  const planned = events.flatMap((e) =>
    taskNoticeRecipients({
      kind: e.kind,
      assignedTo: e.task.assignedTo,
      assignedBy: e.task.assignedBy,
      createdBy: e.task.createdBy,
      actorId: e.actorId,
    }).map((recipientId) => ({ e, recipientId })),
  );
  if (planned.length === 0) return 0;

  // Callers pass one company; group anyway so the access read stays exact.
  const open = new Set<string>();
  for (const cid of new Set(planned.map((p) => p.e.companyId))) {
    const ids = [
      ...new Set(planned.filter((p) => p.e.companyId === cid).map((p) => p.recipientId)),
    ];
    for (const id of await withTaskBoard(tx, cid, ids)) open.add(`${cid}:${id}`);
  }
  const rows = planned.filter((p) => open.has(`${p.e.companyId}:${p.recipientId}`));
  if (rows.length === 0) return 0;

  const written = await tx
    .insert(taskNotices)
    .values(
      rows.map(({ e, recipientId }) => ({
        companyId: e.companyId,
        recipientId,
        taskId: e.task.id,
        kind: e.kind,
        actorId: e.actorId,
        eventAt: e.eventAt,
        createdBy: user.id,
        updatedBy: user.id,
      })),
    )
    .onConflictDoNothing({
      target: [taskNotices.taskId, taskNotices.kind, taskNotices.recipientId, taskNotices.eventAt],
      where: sql`deleted_at IS NULL`,
    })
    .returning({ id: taskNotices.id });
  // Wake the sender once this transaction has committed, so it sees the rows
  // (savepoints and Day Log writes included; the 10 s tick is the backstop).
  if (written.length > 0) afterCommit(kickPushSender);
  return written.length;
}
