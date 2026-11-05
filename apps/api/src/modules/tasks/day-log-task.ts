// ADR-273 (owner 2026-11-05) — the task a Super Admin's Day Log reply raises, on a
// saved entry (linked_ref_id = the line) or a blank date (= the day header). One
// OPEN task per entry / date PER SENDER; further replies reuse it and make it read
// New again. An entry task stays until the person presses Complete; a blank-date
// task also closes when the day is entered (closeDayLogDateTask).
// The reply text is NEVER copied here: tasks is readable company-wide, and the
// fixed wording below must not go stale when a reply is edited. See day-log-replies.ts.
//
// Every function here runs in the caller's transaction UNDER THE DAY HEADER LOCK
// (day-logs/lock.ts), so "is one open?" and the insert cannot interleave; the
// unique index tasks_day_log_reply_open_uq (0242) is the backstop. Lock order:
// day header first, then the task series lock (insertAssignedTask).

import { DAY_LOG_DATE_REF, DAY_LOG_ENTRY_REF } from '@innovic/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { tasks } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { fmtDate } from '../../lib/format-date';
import { autoCloseLinkedTasks } from './auto-close';
import { istToday, OPEN_STATUSES } from './history';
import { insertAssignedTask, usableAssignee } from './service';

type ReplyRef = { companyId: string; refType: string; refId: string };

/** This sender's open task on this entry / date reads New again. ONE conditional
 *  UPDATE: a task already completed or cancelled is left alone. False = none open. */
export async function markReplyTaskNew(
  tx: DbTransaction,
  input: ReplyRef,
  user: AuthContext,
): Promise<boolean> {
  const rows = await tx
    .update(tasks)
    .set({ viewedAt: null, updatedBy: user.id, updatedAt: new Date() })
    .where(
      and(
        eq(tasks.companyId, input.companyId),
        eq(tasks.linkedRefType, input.refType),
        eq(tasks.linkedRefId, input.refId),
        eq(tasks.createdBy, user.id),
        isNull(tasks.deletedAt),
        inArray(tasks.status, [...OPEN_STATUSES]),
      ),
    )
    .returning({ id: tasks.id });
  return rows.length > 0;
}

/** After a reply: the sender's open task reads New again, else a new one is raised.
 *  A person whose Task Board is hidden gets no task; the reply still saves. */
export async function ensureReplyTask(
  tx: DbTransaction,
  input: ReplyRef & {
    assigneeId: string;
    title: string;
    description: string | null;
    display: string;
    navPage: string;
  },
  user: AuthContext,
): Promise<void> {
  if (await markReplyTaskNew(tx, input, user)) return;
  const assignee = await usableAssignee(tx, input.companyId, input.assigneeId);
  if (!assignee) return;
  await insertAssignedTask(
    tx,
    input.companyId,
    assignee,
    {
      title: input.title,
      description: input.description,
      priority: 'medium',
      startDate: null,
      dueDate: istToday(),
      linkedRef: {
        type: input.refType,
        id: input.refId,
        display: input.display,
        navPage: input.navPage,
      },
    },
    user,
  );
}

/** The task of a reply on a saved entry. */
export const ensureEntryReplyTask = (
  tx: DbTransaction,
  input: { companyId: string; entryId: string; assigneeId: string; date: string },
  user: AuthContext,
): Promise<void> =>
  ensureReplyTask(
    tx,
    {
      companyId: input.companyId,
      refType: DAY_LOG_ENTRY_REF,
      refId: input.entryId,
      assigneeId: input.assigneeId,
      title: `Day Log ${fmtDate(input.date)} — reply`,
      description: null,
      display: `Day Log ${fmtDate(input.date)}`,
      navPage: `/task-board?view=daylog&date=${input.date}&line=${input.entryId}`,
    },
    user,
  );

/** The task of a reply on a blank date. */
export const ensureDateReplyTask = (
  tx: DbTransaction,
  input: { companyId: string; dailyReportId: string; assigneeId: string; date: string },
  user: AuthContext,
): Promise<void> =>
  ensureReplyTask(
    tx,
    {
      companyId: input.companyId,
      refType: DAY_LOG_DATE_REF,
      refId: input.dailyReportId,
      assigneeId: input.assigneeId,
      title: `Day Log ${fmtDate(input.date)} not entered`,
      description: `Enter your Day Log for ${fmtDate(input.date)}.`,
      display: `Day Log ${fmtDate(input.date)}`,
      navPage: `/task-board?view=daylog&date=${input.date}`,
    },
    user,
  );

/** The day now has entries: its open tasks close, every sender's (ADR-190 auto-close). */
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
