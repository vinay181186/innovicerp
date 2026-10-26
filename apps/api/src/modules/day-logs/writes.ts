// Day Log — the owner's writes on their own day: add by hand, set an entry's
// Work Status, remove the last entry (the timer is in timer.ts), and the
// guards every owner write shares.
// Every write: requireCanWrite (no page tick — ADR-232) → lock the day header
// FOR UPDATE (openDay / lockHeaderById) → recompute summarizeDay from the live
// lines INSIDE that lock → write → bump the header (§20.3). From is always the
// server's nextFrom; `hours` is written only here, from From/To (§20.1).

import {
  type AddDayLogEntryInput,
  type DayLogDetail,
  type SetDayLogEntryStatusInput,
  firstBreakInside,
  hhmmToMin,
  minToHhmm,
  summarizeDay,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireCanWrite } from '../../lib/access';
import { isUniqueViolation } from '../../lib/db-retry';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import { type Viewer, loadDayUser, loadViewer } from './access';
import {
  type DayHeader,
  loadLines,
  lockHeaderById,
  nextLineNo,
  openDay,
  spansOf,
  touchDay,
} from './day';
import { buildDetail, findBlockedBy, findStrayTimer, notOpenError } from './detail';
import { dmy, istClock } from './rules';

export const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

export const hoursOf = (fromTime: string, toTime: string): string =>
  ((hhmmToMin(toTime) - hhmmToMin(fromTime)) / 60).toFixed(2);

/** A 23505 from the one-running-timer index (drizzle may wrap the pg error). */
export const uniqueHit = (e: unknown): boolean =>
  isUniqueViolation(e) || isUniqueViolation((e as { cause?: unknown } | null)?.cause);

/** D3 + D10 + open — every owner write except Stop. */
export async function guardOwnerWrite(
  tx: DbTransaction,
  companyId: string,
  h: DayHeader,
  today: string,
): Promise<void> {
  if (h.status !== 'open') throw notOpenError(h);
  const blocked = await findBlockedBy(tx, companyId, h.userId, h.date);
  if (blocked) throw new ConflictError(blocked.reason);
  const stray = await findStrayTimer(tx, companyId, h.userId, today);
  if (stray && stray.date !== h.date) {
    throw new ConflictError(
      `Your timer on ${dmy(stray.date)} is still running since ${stray.fromTime} — stop it with an end time first`,
    );
  }
}

export async function ownerDetail(
  tx: DbTransaction,
  companyId: string,
  v: Viewer,
  user: AuthContext,
  date: string,
  clock: { today: string; nowMin: number },
): Promise<DayLogDetail> {
  const me = await loadDayUser(tx, companyId, user.id);
  if (!me) throw new NotFoundError('User not found');
  return buildDetail(tx, companyId, v, me, date, clock);
}

/** The task must be one of the caller's own (assigned to them, or their to-do). */
export async function assertOwnTask(
  tx: DbTransaction,
  companyId: string,
  userId: string,
  taskId: string | null | undefined,
): Promise<string | null> {
  if (!taskId) return null;
  const rows = (await tx.execute(sql`
    SELECT 1 FROM public.tasks t
    WHERE t.id = ${taskId}::uuid AND t.company_id = ${companyId}::uuid AND t.deleted_at IS NULL
      AND (t.assigned_to = ${userId}::uuid OR (t.task_type = 'personal' AND t.created_by = ${userId}::uuid))
  `)) as unknown as unknown[];
  if (rows.length === 0) throw new ValidationError('That task is not one of yours');
  return taskId;
}

export async function addEntry(
  input: AddDayLogEntryInput,
  user: AuthContext,
): Promise<DayLogDetail> {
  await requireCanWrite(user);
  const v = await loadViewer(user); // before the tx (ADR-229)
  const companyId = requireCompany(user);
  const clock = istClock();
  if (input.date > clock.today)
    throw new ValidationError('You cannot log a day that has not come yet');
  return withUserContext(user, async (tx) => {
    const h = await openDay(tx, companyId, user.id, input.date, user);
    await guardOwnerWrite(tx, companyId, h, clock.today);
    const spans = spansOf(await loadLines(tx, companyId, h.id));
    const s = summarizeDay(spans);
    if (s.running) throw new ConflictError('Stop the running timer first');

    const from = s.nextFrom;
    const fromMin = hhmmToMin(from);
    const toMin = hhmmToMin(input.toTime);
    if (input.date === clock.today && toMin > clock.nowMin) {
      throw new ValidationError(`${input.toTime} is later than now (${minToHhmm(clock.nowMin)})`);
    }
    if (toMin <= fromMin) throw new ValidationError(`To must be after ${from}`);
    const br = firstBreakInside(spans, fromMin, toMin);
    if (br) {
      const name = await breakName(tx, h.id, br.fromTime);
      throw new ValidationError(
        `${name} ${br.fromTime}–${br.toTime} is inside this time — end at ${br.fromTime}`,
      );
    }
    const taskId = await assertOwnTask(tx, companyId, user.id, input.taskId);

    await tx.execute(sql`
      INSERT INTO public.daily_report_lines
        (company_id, daily_report_id, line_no, description, kind, from_time, to_time, task_id,
         status, hours, created_by, updated_by)
      VALUES (${companyId}::uuid, ${h.id}::uuid, ${await nextLineNo(tx, h.id)}, ${input.description},
              'work', ${from}::time, ${input.toTime}::time, ${taskId}::uuid, ${input.status},
              ${hoursOf(from, input.toTime)}, ${user.id}::uuid, ${user.id}::uuid)
    `);
    await touchDay(tx, h.id, user);
    await emitActivityLog(
      tx,
      {
        action: 'CREATE',
        entity: 'Day Log',
        entityId: h.id,
        refId: input.date,
        detail: `Day Log ${dmy(input.date)}: ${from}–${input.toTime} ${input.description}`,
      },
      companyId,
      user,
    );
    return ownerDetail(tx, companyId, v, user, input.date, clock);
  });
}

/** A break line's name (the span shape carries no description). */
export async function breakName(
  tx: DbTransaction,
  reportId: string,
  fromTime: string,
): Promise<string> {
  const rows = (await tx.execute(sql`
    SELECT description FROM public.daily_report_lines
    WHERE daily_report_id = ${reportId}::uuid AND kind = 'break' AND deleted_at IS NULL
      AND from_time = ${fromTime}::time
    LIMIT 1
  `)) as unknown as Array<{ description: string }>;
  return rows[0]?.description ?? 'Break';
}

/** The entry's line + its day, locked; owner only (someone else's → not found). */
async function lockOwnEntry(
  tx: DbTransaction,
  companyId: string,
  user: AuthContext,
  entryId: string,
): Promise<{ h: DayHeader; reportId: string }> {
  const rows = (await tx.execute(sql`
    SELECT l.daily_report_id::text AS report_id FROM public.daily_report_lines l
    JOIN public.daily_reports dr ON dr.id = l.daily_report_id AND dr.deleted_at IS NULL
    WHERE l.id = ${entryId}::uuid AND l.company_id = ${companyId}::uuid AND l.deleted_at IS NULL
      AND dr.user_id = ${user.id}::uuid
  `)) as unknown as Array<{ report_id: string }>;
  const reportId = rows[0]?.report_id;
  if (!reportId) throw new NotFoundError('Entry not found');
  const h = await lockHeaderById(tx, companyId, reportId);
  if (!h) throw new NotFoundError('Entry not found');
  return { h, reportId };
}

export async function setEntryStatus(
  entryId: string,
  input: SetDayLogEntryStatusInput,
  user: AuthContext,
): Promise<DayLogDetail> {
  await requireCanWrite(user);
  const v = await loadViewer(user); // before the tx (ADR-229)
  const companyId = requireCompany(user);
  const clock = istClock();
  return withUserContext(user, async (tx) => {
    const { h } = await lockOwnEntry(tx, companyId, user, entryId);
    await guardOwnerWrite(tx, companyId, h, clock.today);
    const line = (await loadLines(tx, companyId, h.id)).find((l) => l.id === entryId);
    if (!line) throw new NotFoundError('Entry not found');
    if (line.kind !== 'work') throw new ValidationError('A break has no Work Status');
    if (!line.toTime)
      throw new ValidationError('Stop the timer first — its status is set when it stops');
    // §20.4 — write only what was loaded.
    const updated = (await tx.execute(sql`
      UPDATE public.daily_report_lines
      SET status = ${input.status}, updated_at = now(), updated_by = ${user.id}::uuid
      WHERE id = ${entryId}::uuid AND deleted_at IS NULL
        AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${input.updatedAt}::timestamptz)
      RETURNING id
    `)) as unknown as unknown[];
    if (updated.length === 0) {
      // Only the owner writes their entries, so the other change is theirs too.
      const at = new Date(new Date(line.updatedAt).getTime() + 5.5 * 3600 * 1000)
        .toISOString()
        .slice(11, 16);
      throw new ConflictError(
        `You changed this entry in another window at ${at} — reload and redo your change`,
      );
    }
    await touchDay(tx, h.id, user);
    return ownerDetail(tx, companyId, v, user, h.date, clock);
  });
}

/** Remove the LAST work entry of an open day (a running one = cancel the timer). */
export async function deleteEntry(entryId: string, user: AuthContext): Promise<DayLogDetail> {
  await requireCanWrite(user);
  const v = await loadViewer(user); // before the tx (ADR-229)
  const companyId = requireCompany(user);
  const clock = istClock();
  return withUserContext(user, async (tx) => {
    const { h } = await lockOwnEntry(tx, companyId, user, entryId);
    await guardOwnerWrite(tx, companyId, h, clock.today);
    const work = (await loadLines(tx, companyId, h.id)).filter(
      (l) => l.kind === 'work' && l.fromTime,
    );
    const target = work.find((l) => l.id === entryId);
    if (!target)
      throw new ValidationError('A break cannot be removed here — change it in My Breaks');
    const last = work[work.length - 1]!;
    if (last.id !== entryId) {
      throw new ValidationError(
        `Only the last entry can be removed — remove ${last.fromTime} – ${last.toTime ?? 'now'} first`,
      );
    }
    await tx.execute(sql`
      UPDATE public.daily_report_lines
      SET deleted_at = now(), deleted_by = ${user.id}::uuid, updated_at = now(), updated_by = ${user.id}::uuid
      WHERE id = ${entryId}::uuid AND deleted_at IS NULL
    `);
    await touchDay(tx, h.id, user);
    await emitActivityLog(
      tx,
      {
        action: 'DELETE',
        entity: 'Day Log',
        entityId: h.id,
        refId: h.date,
        detail: `Day Log ${dmy(h.date)}: removed ${target.fromTime}–${target.toTime ?? 'running'} ${target.description}`,
      },
      companyId,
      user,
    );
    return ownerDetail(tx, companyId, v, user, h.date, clock);
  });
}
