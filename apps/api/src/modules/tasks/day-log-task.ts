// Day Log Pending Entries (owner 2026-11-05) — the task a Super Admin's reply on
// a blank day raises, one OPEN task per day (linked_ref_id = the day header).
// Every function here runs in the caller's transaction UNDER THE DAY HEADER LOCK
// (day-logs/lock.ts), so "is one open?" and the insert cannot interleave; the
// unique index tasks_day_log_date_open_uq (0239) is the backstop. Lock order:
// day header first, then the task series lock (insertAssignedTask).

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { tasks } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { fmtDate } from '../../lib/format-date';
import { autoCloseLinkedTasks } from './auto-close';
import { istToday, OPEN_STATUSES } from './history';
import { insertAssignedTask, usableAssignee } from './service';

const DAY_LOG_DATE_REF = 'day_log_date';

/** The open task of this day reads New again. ONE conditional UPDATE: a task
 *  already completed or cancelled is left alone. False = no open task. */
export async function markDayLogDateTaskNew(
  tx: DbTransaction,
  input: { companyId: string; dailyReportId: string },
  user: AuthContext,
): Promise<boolean> {
  const rows = await tx
    .update(tasks)
    .set({ viewedAt: null, updatedBy: user.id, updatedAt: new Date() })
    .where(
      and(
        eq(tasks.companyId, input.companyId),
        eq(tasks.linkedRefType, DAY_LOG_DATE_REF),
        eq(tasks.linkedRefId, input.dailyReportId),
        isNull(tasks.deletedAt),
        inArray(tasks.status, [...OPEN_STATUSES]),
      ),
    )
    .returning({ id: tasks.id });
  return rows.length > 0;
}

/** After a reply: the open task reads New again, else a new one is raised. A
 *  person whose Task Board is hidden gets no task; the reply still saves. */
export async function ensureDayLogDateTask(
  tx: DbTransaction,
  input: {
    companyId: string;
    dailyReportId: string;
    assigneeId: string;
    date: string;
  },
  user: AuthContext,
): Promise<void> {
  if (await markDayLogDateTaskNew(tx, input, user)) return;
  const assignee = await usableAssignee(tx, input.companyId, input.assigneeId);
  if (!assignee) return;
  await insertAssignedTask(
    tx,
    input.companyId,
    assignee,
    {
      title: `Day Log ${fmtDate(input.date)} not entered`,
      // Fixed: the reply can be edited or followed by another; the task must not go stale.
      description: `Enter your Day Log for ${fmtDate(input.date)}.`,
      priority: 'medium',
      startDate: null,
      dueDate: istToday(),
      linkedRef: {
        type: DAY_LOG_DATE_REF,
        id: input.dailyReportId,
        display: `Day Log ${fmtDate(input.date)}`,
        navPage: `/task-board?view=daylog&date=${input.date}`,
      },
    },
    user,
  );
}

/** The day now has entries: its open task closes (ADR-190 auto-close). */
export const closeDayLogDateTask = (
  tx: DbTransaction,
  input: { companyId: string; dailyReportId: string; date: string },
  user: AuthContext,
): Promise<number> =>
  autoCloseLinkedTasks(
    tx,
    {
      companyId: input.companyId,
      refTypes: [DAY_LOG_DATE_REF],
      refId: input.dailyReportId,
      doneLabel: `Day Log ${fmtDate(input.date)} entered`,
    },
    user,
  );
