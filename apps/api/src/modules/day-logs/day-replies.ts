// Day Log — Super Admin replies on a person's BLANK day (Pending Entries, owner
// 2026-11-05). The day has no line to hang a reply on, so it hangs on the day
// header (daily_report_day_replies, 0239); a reply on a saved entry stays in
// replies.ts. Who may send, edit: as replies.ts (guardReplier). The owner gets a
// task per sender (tasks/day-log-task.ts), closed when the day's entries are saved.
//
// §20:
//   - One writer of a day reply: this file, through replies.ts writeReply (the
//     reply + the header bump, ONE statement).
//   - Lock: every function's first statement locks the day header (lock.ts);
//     sendDayReply's opens it too. "The day has no line" is read after that
//     lock, so a save and a reply on one day cannot cross: the loser of the
//     lock sees the other's result (reply → 409, or the entry closes the task).
//   - Edit: WHERE updated_at = what was loaded (replies.ts editReplyRow, §20.4).
//   - Seen: WHERE seen_at IS NULL, so a repeat changes nothing. The owner's task
//     dot clears in that same statement (ADR-273).

import {
  DAY_LOG_DATE_REF,
  type DayLogAdminReply,
  type DayLogDayRepliesSeenInput,
  type DayLogStatus,
  type EditDayLogReplyInput,
  type SendDayLogDayReplyInput,
  isWorkingDay,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { AuthContext } from '../../db/with-user-context';
import { ConflictError, ValidationError } from '../../lib/errors';
import { ensureDateReplyTask, markReplyTaskNew } from '../tasks/day-log-task';
import { type DayPerson, resolveAccess } from './access';
import { dayTx, lockDayReplyDay, lockOwnDay, openTargetDayLocked } from './lock';
import { isPendingEligible } from './pending';
import { RETURN_COLS, editReplyRow, guardReplier, writeReply } from './replies';
import { type DayLogClock, dmy, istClock } from './rules';
import { readSnapshot } from './snapshot';
import { requireCompany } from './writes';

/**
 * Why nobody may reply on this person's day, or null. The ONE rule behind the
 * send guard and the screen's canReplyDay (§20.5). The day having no line and
 * the caller being a Super Admin are judged by each of them separately.
 */
export function dayReplyBlock(
  target: DayPerson | null,
  date: string,
  status: DayLogStatus,
  holidays: readonly string[],
  clock: DayLogClock,
): string | null {
  if (!target || !target.isActive) return 'This person is not active';
  if (!isPendingEligible(target)) return `${target.name} is not asked to keep a Day Log`;
  if (date > clock.today) return `${dmy(date)} has not come yet`;
  if (date < target.pendingStart) return `${dmy(date)} is before ${target.name}'s Day Log start`;
  if (!isWorkingDay(date, holidays)) return `${dmy(date)} is not a working day`;
  if (status === 'leave') return `${dmy(date)} is marked Leave`;
  return null;
}

const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

/** POST /day-logs/day-replies */
export async function sendDayReply(
  input: SendDayLogDayReplyInput,
  user: AuthContext,
  clock: DayLogClock = istClock(), // tests only — routes never pass it
): Promise<DayLogAdminReply> {
  const companyId = requireCompany(user);
  const body = input.body.trim();
  if (!body) throw new ValidationError('Write the reply');
  return dayTx(async (tx) => {
    // The day lock: opens the header if it is the day's first write. Any
    // refusal below throws, so that header rolls back with it.
    const locked = await openTargetDayLocked(tx, user, companyId, input.userId, input.date);
    await guardReplier(user, locked); // Super Admin only, an Auditor never, not one's own
    const h = locked.header;
    const snap = await readSnapshot(
      { companyId, viewerId: null, targetId: input.userId, date: h.date },
      tx,
    );
    const block = dayReplyBlock(locked.target, h.date, h.status, [...snap.holidays.keys()], clock);
    if (block) throw new ValidationError(block);
    if (snap.lines.length > 0) {
      const who = firstName(locked.target!.name);
      throw new ConflictError(`${who} has just entered this day — reply on the entry`);
    }
    const reply = await writeReply(
      tx,
      h,
      user,
      sql`
      INSERT INTO public.daily_report_day_replies
        (company_id, daily_report_id, body, sent_at, created_by, updated_by)
      VALUES (${companyId}::uuid, ${h.id}::uuid, ${body}, clock_timestamp(),
              ${user.id}::uuid, ${user.id}::uuid)
      RETURNING ${RETURN_COLS}`,
    );
    if (!reply) throw new ConflictError('The reply could not be saved — reload and try again');
    await ensureDateReplyTask(
      tx,
      {
        companyId,
        dailyReportId: h.id,
        assigneeId: input.userId,
        date: h.date,
      },
      user,
    );
    return reply;
  });
}

/** PATCH /day-logs/day-replies/:id — a new text; seen_at back to NULL, and the
 *  open task reads New again. */
export async function editDayReply(
  replyId: string,
  input: EditDayLogReplyInput,
  user: AuthContext,
): Promise<DayLogAdminReply> {
  const companyId = requireCompany(user);
  if (!input.body.trim()) throw new ValidationError('Write the reply');
  return dayTx(async (tx) => {
    const locked = await lockDayReplyDay(tx, user, companyId, replyId);
    const { h } = await guardReplier(user, locked);
    const reply = await editReplyRow(
      tx,
      h,
      user,
      companyId,
      'daily_report_day_replies',
      replyId,
      input,
    );
    await markReplyTaskNew(tx, { companyId, refType: DAY_LOG_DATE_REF, refId: h.id }, user);
    return reply;
  });
}

/**
 * POST /day-logs/day-replies/seen — the owner opened this date: every reply not
 * yet seen gets seen_at = now, ONE conditional statement. Owner only: the lock
 * finds only the caller's own day. The header is bumped only when something
 * changed, so the Super Admin's screen and the bell refresh.
 */
export async function markDayRepliesSeen(
  input: DayLogDayRepliesSeenInput,
  user: AuthContext,
): Promise<{ seen: number }> {
  const companyId = requireCompany(user);
  return dayTx(async (tx) => {
    const locked = await lockOwnDay(tx, user, companyId, input.date);
    await resolveAccess(user, locked.access);
    const h = locked.header;
    if (!h) return { seen: 0 };
    const [r] = (await tx.execute(sql`
      WITH s AS (
        UPDATE public.daily_report_day_replies
        SET seen_at = now()
        WHERE daily_report_id = ${h.id}::uuid AND company_id = ${companyId}::uuid
          AND seen_at IS NULL AND deleted_at IS NULL
        RETURNING 1),
      t AS (
        UPDATE public.daily_reports SET updated_at = now(), updated_by = ${user.id}::uuid
        WHERE id = ${h.id}::uuid AND EXISTS (SELECT 1 FROM s)
        RETURNING 1),
      v AS (
        UPDATE public.tasks SET viewed_at = now()
        WHERE company_id = ${companyId}::uuid AND assigned_to = ${user.id}::uuid
          AND linked_ref_type = ${DAY_LOG_DATE_REF} AND linked_ref_id = ${h.id}
          AND deleted_at IS NULL AND status IN ('todo', 'in_progress')
          AND EXISTS (SELECT 1 FROM s)
        RETURNING 1)
      SELECT (SELECT count(*) FROM s)::int AS seen, (SELECT count(*) FROM t)::int AS touched
    `)) as unknown as Array<{ seen: number }>;
    return { seen: Number(r?.seen ?? 0) };
  });
}
