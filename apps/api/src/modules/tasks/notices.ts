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
//   never the person who did it; never a private to-do (isPrivateTodo).
// A duplicate (same task, kind, recipient, event time) is ignored
// (ON CONFLICT DO NOTHING on task_notices_event_uq).

import type { TaskNoticeKind } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { taskNotices } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { kickPushSender } from '../push/kick';
import { isPrivateTodo } from './history';

export interface TaskNoticeParties {
  kind: TaskNoticeKind;
  assignedTo: string | null;
  assignedBy: string | null;
  createdBy: string | null;
  actorId: string | null;
}

/** Who is told about one task event. Pure. */
export function taskNoticeRecipients(p: TaskNoticeParties): string[] {
  if (isPrivateTodo({ createdBy: p.createdBy ?? '', assignedTo: p.assignedTo })) return [];
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

/** Insert the event's notices in the caller's transaction (none for a
 *  private to-do or when only the actor is involved), then wake the push
 *  sender. Returns how many rows were written. */
export async function recordTaskNotices(
  tx: DbTransaction,
  input: RecordTaskNoticesInput,
  user: AuthContext,
): Promise<number> {
  const recipients = taskNoticeRecipients({
    kind: input.kind,
    assignedTo: input.task.assignedTo,
    assignedBy: input.task.assignedBy,
    createdBy: input.task.createdBy,
    actorId: input.actorId,
  });
  if (recipients.length === 0) return 0;
  const written = await tx
    .insert(taskNotices)
    .values(
      recipients.map((recipientId) => ({
        companyId: input.companyId,
        recipientId,
        taskId: input.task.id,
        kind: input.kind,
        actorId: input.actorId,
        eventAt: input.eventAt,
        createdBy: user.id,
        updatedBy: user.id,
      })),
    )
    .onConflictDoNothing({
      target: [taskNotices.taskId, taskNotices.kind, taskNotices.recipientId, taskNotices.eventAt],
      where: sql`deleted_at IS NULL`,
    })
    .returning({ id: taskNotices.id });
  // Debounced (~1 s) in the sender, so the flush runs after this commits.
  if (written.length > 0) kickPushSender();
  return written.length;
}
