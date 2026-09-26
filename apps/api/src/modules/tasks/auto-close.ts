// Task auto-close (ADR-189). When the action a task was raised for is done
// somewhere else in the app — the QC call inspected, the GRN inspected, the NC
// disposed — the open tasks linked to that document are
// completed here, inside the caller's transaction, so the task and the action
// commit or roll back together.
//
// This is the ONLY way another module closes a task. It deliberately does not
// go through transitionStatus: that enforces the per-task permission matrix
// (assignee / creator / admin), and the person who inspects the goods is
// usually neither. The close is recorded honestly instead — completed_by is
// the user who did the action, the remark and the history note say it was
// closed automatically and by which document — so the task's timeline shows
// who finished the work and why the task closed without anyone touching it.
//
// Matching: tasks.linked_ref_type is free text and the web has written both
// 'grn' and 'GRN' for the same kind, so the type compares case-insensitively;
// linked_ref_id is the document's own id.

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { tasks } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { emitActivityLog } from '../activity-log/service';
import { istToday, OPEN_STATUSES, recordHistory, statusLabel } from './history';

export interface AutoCloseLinkedTasksInput {
  companyId: string;
  /** Every linked_ref_type spelling that means this document kind. */
  refTypes: readonly string[];
  /** The document's id — tasks.linked_ref_id. */
  refId: string;
  /** How the document is named in the remark, e.g. `GRN GRN-0042 inspected`. */
  doneLabel: string;
}

/** Complete every open task linked to one document. Returns how many closed.
 *  A no-op (0) when nothing is linked, which is the common case. */
export async function autoCloseLinkedTasks(
  tx: DbTransaction,
  input: AutoCloseLinkedTasksInput,
  user: AuthContext,
): Promise<number> {
  const types = input.refTypes.map((t) => t.toLowerCase());
  if (types.length === 0) return 0;

  const open = await tx
    .select({ id: tasks.id, code: tasks.code, status: tasks.status })
    .from(tasks)
    .where(
      and(
        eq(tasks.companyId, input.companyId),
        isNull(tasks.deletedAt),
        inArray(tasks.status, [...OPEN_STATUSES]),
        eq(tasks.linkedRefId, input.refId),
        inArray(sql`lower(${tasks.linkedRefType})`, types),
      ),
    );
  if (open.length === 0) return 0;

  const remark = `Closed automatically: ${input.doneLabel}`;
  const now = new Date();
  const today = istToday();
  await tx
    .update(tasks)
    .set({
      status: 'completed',
      completedAt: now,
      completedBy: user.id,
      completedDate: today,
      completionRemark: remark,
      updatedBy: user.id,
      updatedAt: now,
    })
    .where(
      inArray(
        tasks.id,
        open.map((t) => t.id),
      ),
    );

  for (const t of open) {
    await recordHistory(
      tx,
      input.companyId,
      t.id,
      {
        action: 'status_changed',
        fromValue: statusLabel(t.status),
        toValue: statusLabel('completed'),
        note: remark,
      },
      user,
    );
    await recordHistory(tx, input.companyId, t.id, { action: 'completed', note: remark }, user);
    await emitActivityLog(
      tx,
      {
        action: 'UPDATE',
        entity: 'Task',
        detail: `${t.code} → completed (${remark})`,
        refId: t.code,
      },
      input.companyId,
      user,
    );
  }
  return open.length;
}
