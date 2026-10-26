// Day Log — the timer: Start (today only, one running timer per person —
// D11) and Stop (cut at the next break; an earlier day's timer needs the end
// time — D10). Same lock-then-recompute shape as writes.ts (§20.3).

import {
  type DayLogDetail,
  type StartDayLogTimerInput,
  type StopDayLogTimerInput,
  firstBreakInside,
  hhmmToMin,
  minToHhmm,
  summarizeDay,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireCanWrite } from '../../lib/access';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { loadViewer } from './access';
import { loadLines, lockHeaderById, nextLineNo, openDay, spansOf, touchDay } from './day';
import { notOpenError } from './detail';
import { breakAt, dmy, istClock } from './rules';
import {
  assertOwnTask,
  breakName,
  guardOwnerWrite,
  hoursOf,
  ownerDetail,
  requireCompany,
  uniqueHit,
} from './writes';

/** Start refused because time before now is not logged yet. A 409 the screen
 *  tells apart by its code ("day_log_gap") to offer "start from HH:MM". */
export class DayLogGapError extends ConflictError {
  override readonly code: string = 'day_log_gap';
}

interface RunningRow {
  id: string;
  reportId: string;
  date: string;
  fromTime: string;
  description: string;
}

/** The caller's running work entry on ANY day (D11 — one at a time). */
async function findRunning(
  tx: DbTransaction,
  companyId: string,
  userId: string,
): Promise<RunningRow | null> {
  const rows = (await tx.execute(sql`
    SELECT l.id::text AS id, dr.id::text AS report_id, to_char(dr.report_date, 'YYYY-MM-DD') AS d,
           to_char(l.from_time, 'HH24:MI') AS f, l.description
    FROM public.daily_report_lines l
    JOIN public.daily_reports dr ON dr.id = l.daily_report_id AND dr.deleted_at IS NULL
    WHERE dr.company_id = ${companyId}::uuid AND dr.user_id = ${userId}::uuid
      AND l.kind = 'work' AND l.to_time IS NULL AND l.from_time IS NOT NULL AND l.deleted_at IS NULL
    ORDER BY dr.report_date DESC LIMIT 1
  `)) as unknown as Array<{
    id: string;
    report_id: string;
    d: string;
    f: string;
    description: string;
  }>;
  const r = rows[0];
  return r
    ? { id: r.id, reportId: r.report_id, date: r.d, fromTime: r.f, description: r.description }
    : null;
}

export async function startTimer(
  input: StartDayLogTimerInput,
  user: AuthContext,
): Promise<DayLogDetail> {
  await requireCanWrite(user);
  const v = await loadViewer(user); // before the tx (ADR-229)
  const companyId = requireCompany(user);
  const clock = istClock();
  const date = clock.today;
  try {
    return await withUserContext(user, async (tx) => {
      const h = await openDay(tx, companyId, user.id, date, user);
      await guardOwnerWrite(tx, companyId, h, clock.today);
      const running = await findRunning(tx, companyId, user.id);
      if (running) {
        throw new ConflictError(
          `A timer is already running since ${running.fromTime}${running.date === date ? '' : ` on ${dmy(running.date)}`} — stop it first`,
        );
      }
      const spans = spansOf(await loadLines(tx, companyId, h.id));
      const s = summarizeDay(spans);
      const now = clock.nowMin;
      const nowHm = minToHhmm(now);
      const on = breakAt(spans, now);
      if (on) {
        const name = await breakName(tx, h.id, on.fromTime);
        throw new ConflictError(`You are on ${name} until ${on.toTime}`);
      }
      const next = hhmmToMin(s.nextFrom);
      let start = now;
      if (now > next) {
        if (!input.includeGap) {
          throw new DayLogGapError(
            `${s.nextFrom} – ${nowHm} is not logged yet — start from ${s.nextFrom} or log it by hand first`,
          );
        }
        const br = firstBreakInside(spans, next, now);
        if (br) {
          throw new ConflictError(
            `A break (${br.fromTime}–${br.toTime}) is in between — log ${s.nextFrom} – ${br.fromTime} by hand first`,
          );
        }
        start = next;
      }
      const taskId = await assertOwnTask(tx, companyId, user.id, input.taskId);
      await tx.execute(sql`
        INSERT INTO public.daily_report_lines
          (company_id, daily_report_id, line_no, description, kind, from_time, to_time, task_id,
           status, hours, created_by, updated_by)
        VALUES (${companyId}::uuid, ${h.id}::uuid, ${await nextLineNo(tx, h.id)}, ${input.description},
                'work', ${minToHhmm(start)}::time, NULL, ${taskId}::uuid, 'in_progress', 0,
                ${user.id}::uuid, ${user.id}::uuid)
      `);
      await touchDay(tx, h.id, user);
      return ownerDetail(tx, companyId, v, user, date, clock);
    });
  } catch (e) {
    if (uniqueHit(e)) throw new ConflictError('A timer is already running — stop it first');
    throw e;
  }
}

export async function stopTimer(
  input: StopDayLogTimerInput,
  user: AuthContext,
): Promise<DayLogDetail> {
  await requireCanWrite(user);
  const v = await loadViewer(user); // before the tx (ADR-229)
  const companyId = requireCompany(user);
  const clock = istClock();
  return withUserContext(user, async (tx) => {
    const found = await findRunning(tx, companyId, user.id);
    if (!found) throw new NotFoundError('No timer is running');
    const h = await lockHeaderById(tx, companyId, found.reportId);
    if (!h) throw new NotFoundError('No timer is running');
    if (h.status !== 'open') throw notOpenError(h);
    const lines = await loadLines(tx, companyId, h.id);
    const line = lines.find((l) => l.id === found.id);
    if (!line || line.toTime) throw new ConflictError('This timer was already stopped — reload');
    const spans = spansOf(lines);
    const startMin = hhmmToMin(found.fromTime);

    let end: number;
    let note: string | null = null;
    if (h.date === clock.today) {
      end = clock.nowMin;
      const br = firstBreakInside(spans, startMin, end);
      if (br) {
        end = hhmmToMin(br.fromTime);
        note = `stopped at ${br.fromTime} for your ${await breakName(tx, h.id, br.fromTime)} break`;
      }
      if (end <= startMin) {
        throw new ValidationError('The timer has not run a full minute — remove the entry instead');
      }
    } else {
      // D10 — left running overnight: the owner says when work stopped.
      if (!input.endTime) {
        throw new ValidationError(`Give the time you stopped work on ${dmy(h.date)}`);
      }
      end = hhmmToMin(input.endTime);
      if (end <= startMin) throw new ValidationError(`End must be after ${found.fromTime}`);
      const br = firstBreakInside(spans, startMin, end);
      if (br) {
        throw new ValidationError(
          `${await breakName(tx, h.id, br.fromTime)} ${br.fromTime}–${br.toTime} is inside this time — end at ${br.fromTime}`,
        );
      }
    }
    const endHm = minToHhmm(end);
    const updated = (await tx.execute(sql`
      UPDATE public.daily_report_lines
      SET to_time = ${endHm}::time, hours = ${hoursOf(found.fromTime, endHm)}, status = ${input.status},
          stop_note = ${note}, updated_at = now(), updated_by = ${user.id}::uuid
      WHERE id = ${found.id}::uuid AND to_time IS NULL AND deleted_at IS NULL
      RETURNING id
    `)) as unknown as unknown[];
    if (updated.length === 0) throw new ConflictError('This timer was already stopped — reload');
    await touchDay(tx, h.id, user);
    return ownerDetail(tx, companyId, v, user, h.date, clock);
  });
}
