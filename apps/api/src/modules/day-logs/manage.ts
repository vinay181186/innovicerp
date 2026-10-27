// Day Log — reading a day, the owner's Submit, and the Department Admin's
// Reopen / Leave (server only for now — the screen does not offer them). Status changes are conditional UPDATEs on
// day_status, made under the header lock (§20.2 / §20.3); 0 rows = someone got
// there first → 409 naming who.

import {
  DAY_LOG_RULES,
  type DayLogDateInput,
  type DayLogDetail,
  type DayLogQuery,
  fmt12,
  fmtDuration,
  isWorkingDay,
  summarizeDay,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireCanWrite } from '../../lib/access';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import {
  loadViewer,
  requireManagedUser,
  requireVisibleUser,
  resolveAccess,
  viewerOf,
  visibleUser,
} from './access';
import { holidaysBetween, loadLines, openDay, readHeader, spansOf } from './day';
import { blockedByOf, buildDetail, detailOf, findBlockedBy, notOpenError } from './detail';
import { type DayLogClock, dmy, firstGap, istClock } from './rules';
import { readSnapshot } from './snapshot';
import { requireCompany } from './writes';

/** Reopen / Leave body. Kept here: the shared contract (day-log.ts) no longer
 *  carries it because the screen does not call these two now. */
export const dayLogReasonInputSchema = z.object({
  userId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(3, 'Give a reason').max(500),
});
export type DayLogReasonInput = z.infer<typeof dayLogReasonInputSchema>;

/** GET a day. Creates nothing: a day with no header reads as Open with no
 *  entries. Someone else's day → not found unless allowed. ONE statement:
 *  the viewer's access and the whole day (snapshot.ts), judged in memory. */
export async function getDay(
  query: DayLogQuery,
  user: AuthContext,
  clock: DayLogClock = istClock(), // tests only — routes never pass it
): Promise<DayLogDetail> {
  const companyId = requireCompany(user);
  const date = query.date ?? clock.today;
  const snap = await readSnapshot({
    companyId,
    viewerId: user.id,
    targetId: query.userId ?? user.id,
    date,
  });
  const v = viewerOf(user, await resolveAccess(user, snap.access));
  const target = visibleUser(v, snap.target);
  return detailOf(snap, blockedByOf(snap, date), v, target, date, clock);
}

/** Submit Day: nothing Open and 09:00–18:00 fully covered (work + break).
 *  The status change is conditional on day_status = 'open' (§20.2). */
export async function submitDay(
  input: DayLogDateInput,
  user: AuthContext,
  clock: DayLogClock = istClock(), // tests only — routes never pass it
): Promise<DayLogDetail> {
  await requireCanWrite(user);
  const v = await loadViewer(user);
  const companyId = requireCompany(user);
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
    if (s.open) throw new ConflictError('Stop the Open entry first');
    if (s.unloggedMin > 0) {
      const gap = firstGap(spans);
      throw new ValidationError(
        `${fmtDuration(s.unloggedMin)} of ${fmt12(DAY_LOG_RULES.workFrom)}–${fmt12(DAY_LOG_RULES.workTo)} is not logged yet${gap ? ` — ${gap} is empty` : ''}`,
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
    const h = await openDay(tx, companyId, target.id, input.date, user);
    if (h.status !== 'open') throw notOpenError(h);
    if ((await loadLines(tx, companyId, h.id)).some((l) => l.fromTime)) {
      throw new ValidationError(`${dmy(input.date)} has entries — it cannot be marked Leave`);
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
