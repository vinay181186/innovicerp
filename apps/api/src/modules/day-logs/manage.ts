// Day Log — reading a day, the owner's Submit, and the Department Admin's
// Reopen / Leave / Remind. Status changes are conditional UPDATEs on
// day_status, made under the header lock (§20.2 / §20.3); 0 rows = someone got
// there first → 409 naming who.

import {
  type DayLogDateInput,
  type DayLogDetail,
  type DayLogQuery,
  type DayLogReasonInput,
  type DayLogUserDayInput,
  fmtDuration,
  isWorkingDay,
  summarizeDay,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireCanWrite } from '../../lib/access';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import { loadViewer, requireManagedUser, requireVisibleUser } from './access';
import { holidaysBetween, loadLines, openDay, readHeader, spansOf } from './day';
import { buildDetail, findBlockedBy, notOpenError } from './detail';
import { dmy, firstGap, istClock } from './rules';
import { requireCompany } from './writes';

/** GET a day. Creates nothing: a day with no header reads as Open with the
 *  user's break template. Someone else's day → not found unless allowed. */
export async function getDay(query: DayLogQuery, user: AuthContext): Promise<DayLogDetail> {
  const companyId = requireCompany(user);
  const v = await loadViewer(user); // before the tx (ADR-229)
  const clock = istClock();
  const date = query.date ?? clock.today;
  return withUserContext(user, async (tx) => {
    const target = await requireVisibleUser(tx, companyId, v, query.userId ?? user.id);
    return buildDetail(tx, companyId, v, target, date, clock);
  });
}

export async function submitDay(input: DayLogDateInput, user: AuthContext): Promise<DayLogDetail> {
  await requireCanWrite(user);
  const v = await loadViewer(user);
  const companyId = requireCompany(user);
  const clock = istClock();
  if (input.date > clock.today)
    throw new ValidationError('You cannot submit a day that has not come yet');
  return withUserContext(user, async (tx) => {
    const h = await readHeader(tx, companyId, user.id, input.date, true); // FOR UPDATE
    if (!h) throw new ValidationError(`Nothing is logged on ${dmy(input.date)} yet`);
    if (h.status !== 'open') throw notOpenError(h);
    const blocked = await findBlockedBy(tx, companyId, user.id, input.date);
    if (blocked) throw new ConflictError(blocked.reason);
    const spans = spansOf(await loadLines(tx, companyId, h.id));
    const hol = await holidaysBetween(tx, companyId, input.date, input.date);
    const s = summarizeDay(spans, undefined, isWorkingDay(input.date, [...hol.keys()]));
    if (s.running) throw new ConflictError('Stop the running timer first');
    if (s.missingMin > 0) {
      const gap = firstGap(spans);
      throw new ValidationError(
        `${fmtDuration(s.missingMin)} is not logged yet${gap ? ` — ${gap} is empty` : ''}`,
      );
    }
    const done = (await tx.execute(sql`
      UPDATE public.daily_reports
      SET day_status = 'submitted', submitted_at = now(), submitted_by = ${user.id}::uuid,
          updated_at = now(), updated_by = ${user.id}::uuid
      WHERE id = ${h.id}::uuid AND day_status = 'open' AND deleted_at IS NULL
      RETURNING id
    `)) as unknown as unknown[];
    if (done.length === 0) {
      const now = await readHeader(tx, companyId, user.id, input.date);
      throw now ? notOpenError(now) : new ConflictError('This day changed — reload');
    }
    await emitActivityLog(
      tx,
      {
        action: 'SUBMIT',
        entity: 'Day Log',
        entityId: h.id,
        refId: input.date,
        detail: `Submitted Day Log ${dmy(input.date)}`,
      },
      companyId,
      user,
    );
    const me = await requireVisibleUser(tx, companyId, v, user.id);
    return buildDetail(tx, companyId, v, me, input.date, clock);
  });
}

export async function reopenDay(
  input: DayLogReasonInput,
  user: AuthContext,
): Promise<DayLogDetail> {
  const v = await loadViewer(user);
  const companyId = requireCompany(user);
  const clock = istClock();
  return withUserContext(user, async (tx) => {
    const target = await requireManagedUser(tx, companyId, v, input.userId);
    const h = await readHeader(tx, companyId, target.id, input.date, true); // FOR UPDATE
    if (!h) throw new NotFoundError(`${target.name} has no Day Log on ${dmy(input.date)}`);
    const done = (await tx.execute(sql`
      UPDATE public.daily_reports
      SET day_status = 'open', reopened_at = now(), reopened_by = ${user.id}::uuid,
          reopen_reason = ${input.reason}, updated_at = now(), updated_by = ${user.id}::uuid
      WHERE id = ${h.id}::uuid AND day_status IN ('submitted', 'leave') AND deleted_at IS NULL
      RETURNING id
    `)) as unknown as unknown[];
    if (done.length === 0) throw new ConflictError(`${dmy(input.date)} is already open`);
    await emitActivityLog(
      tx,
      {
        action: 'REOPEN',
        entity: 'Day Log',
        entityId: h.id,
        refId: input.date,
        reason: input.reason,
        detail: `Reopened ${target.name}'s Day Log ${dmy(input.date)}`,
      },
      companyId,
      user,
    );
    return buildDetail(tx, companyId, v, target, input.date, clock);
  });
}

export async function markLeave(
  input: DayLogReasonInput,
  user: AuthContext,
): Promise<DayLogDetail> {
  const v = await loadViewer(user);
  const companyId = requireCompany(user);
  const clock = istClock();
  return withUserContext(user, async (tx) => {
    const target = await requireManagedUser(tx, companyId, v, input.userId);
    // Upsert on daily_reports_user_day_uq, then lock (§20.3).
    const h = await openDay(tx, companyId, target.id, input.date, user, false);
    if (h.status !== 'open') throw notOpenError(h);
    const work = (await loadLines(tx, companyId, h.id)).filter((l) => l.kind === 'work');
    if (work.length > 0) {
      throw new ValidationError(`${dmy(input.date)} has work logged — it cannot be marked Leave`);
    }
    const done = (await tx.execute(sql`
      UPDATE public.daily_reports
      SET day_status = 'leave', leave_reason = ${input.reason},
          updated_at = now(), updated_by = ${user.id}::uuid
      WHERE id = ${h.id}::uuid AND day_status = 'open' AND deleted_at IS NULL
      RETURNING id
    `)) as unknown as unknown[];
    if (done.length === 0) throw new ConflictError(`${dmy(input.date)} changed — reload`);
    await emitActivityLog(
      tx,
      {
        action: 'LEAVE',
        entity: 'Day Log',
        entityId: h.id,
        refId: input.date,
        reason: input.reason,
        detail: `Marked ${target.name} on Leave for ${dmy(input.date)}`,
      },
      companyId,
      user,
    );
    return buildDetail(tx, companyId, v, target, input.date, clock);
  });
}

/** Remind: an activity-log event the TARGET sees on their Home notifications
 *  (dashboard/personal/notifications.ts, rule Day Log / REMIND). The day is
 *  opened if it has no header yet, so entity_id = that day's header (the note
 *  is kept only while the day is the reader's own and still open); ref_id =
 *  the date as printed, "26-10-2026". */
export async function remindUser(
  input: DayLogUserDayInput,
  user: AuthContext,
): Promise<{ ok: true }> {
  const v = await loadViewer(user);
  const companyId = requireCompany(user);
  const clock = istClock();
  if (input.date > clock.today) throw new ValidationError('That day has not come yet');
  return withUserContext(user, async (tx) => {
    const target = await requireManagedUser(tx, companyId, v, input.userId);
    if (target.id === user.id) throw new ValidationError('You cannot remind yourself');
    const h = await openDay(tx, companyId, target.id, input.date, user);
    if (h.status !== 'open') throw notOpenError(h);
    await emitActivityLog(
      tx,
      {
        action: 'REMIND',
        entity: 'Day Log',
        entityId: h.id,
        refId: dmy(input.date),
        detail: `Reminded ${target.name} to complete the Day Log for ${dmy(input.date)}`,
      },
      companyId,
      user,
    );
    return { ok: true as const };
  });
}
