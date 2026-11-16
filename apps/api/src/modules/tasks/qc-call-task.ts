// ADR-298 (owner 2026-11-16) — the task QC Center's Assign Inspector / Pick Up
// raises, so the inspector sees the QC call in their Task Board Inbox (or My
// To-Do when they picked it up themselves) and on Home › My to-do.
//
// ONE task per assignment: qc_assignments.task_id (0253) names it. A reassign
// MOVES that task (as Task Board's Reassign does); a task someone typed by hand
// for the same call is never touched. The task closes itself when the call has
// nothing left to inspect (autoCloseLinkedTasks 'qc_call', op-entry, ADR-190).
//
// Runs in the caller's transaction, after the caller locked the jc_ops row, so
// two Assigns on one call take turns. Lock order: jc_ops row, then the task
// series lock (insertAssignedTask).

import { taskRelatedNavPage } from '@innovic/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { tasks } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { emitActivityLog } from '../activity-log/service';
import { OPEN_STATUSES, loadUserNames, nameOf, recordHistory } from './history';
import { insertAssignedTask, usableAssignee } from './service';

export interface QcCallTaskInput {
  companyId: string;
  jcOpId: string;
  /** The task the call's assignment already holds (qc_assignments.task_id). */
  currentTaskId: string | null;
  inspectorUserId: string;
  /** "JC-0123 · Op 20" — the same text Assign Task's QC-call picker shows. */
  callLabel: string;
  operation: string | null;
  dueDate: string;
  note: string | null;
}

/** Raise or move the call's task. Returns the task the inspector now holds, or
 *  null when they cannot open the Task Board (the old task, if any, is left with
 *  its holder — the assignment itself still saves). */
export async function raiseOrMoveQcCallTask(
  tx: DbTransaction,
  input: QcCallTaskInput,
  user: AuthContext,
): Promise<{ id: string; code: string } | null> {
  const assignee = await usableAssignee(tx, input.companyId, input.inspectorUserId);
  if (!assignee) return null;

  if (input.currentTaskId) {
    const [t] = await tx
      .select({ id: tasks.id, code: tasks.code, assignedTo: tasks.assignedTo })
      .from(tasks)
      .where(
        and(
          eq(tasks.id, input.currentTaskId),
          eq(tasks.companyId, input.companyId),
          isNull(tasks.deletedAt),
          inArray(tasks.status, [...OPEN_STATUSES]),
        ),
      )
      .for('update');
    if (t) {
      if (t.assignedTo === assignee.id) return { id: t.id, code: t.code };
      const now = new Date();
      await tx
        .update(tasks)
        .set({
          assignedTo: assignee.id,
          assignedBy: user.id,
          assignedAt: now,
          viewedAt: assignee.id === user.id ? now : null,
          updatedBy: user.id,
          updatedAt: now,
        })
        .where(eq(tasks.id, t.id));
      const names = await loadUserNames(tx, input.companyId);
      await recordHistory(
        tx,
        input.companyId,
        t.id,
        {
          action: 'reassigned',
          fromValue: nameOf(names, t.assignedTo) ?? '—',
          toValue: assignee.name,
          note: 'Reassigned in QC Center',
        },
        user,
      );
      await emitActivityLog(
        tx,
        {
          action: 'UPDATE',
          entity: 'Task',
          detail: `${t.code} reassigned to ${assignee.name} (QC Center)`,
          refId: t.code,
        },
        input.companyId,
        user,
      );
      return { id: t.id, code: t.code };
    }
  }

  // No task yet, or the old one is closed: raise a new one.
  const header = await insertAssignedTask(
    tx,
    input.companyId,
    assignee,
    {
      title: `QC inspection: ${input.callLabel}${input.operation ? ` ${input.operation}` : ''}`,
      description: input.note,
      priority: 'medium',
      startDate: null,
      dueDate: input.dueDate,
      linkedRef: {
        type: 'qc_call',
        id: input.jcOpId,
        display: input.callLabel,
        navPage: taskRelatedNavPage('qc_call', input.jcOpId),
      },
    },
    user,
  );
  return { id: header.id, code: header.code };
}
