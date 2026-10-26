// Day Log — the timer, the ONE way to log time (owner 2026-10-26).
//   Start (today only): always begins at the server's nextFrom, so the day
//   never has a gap. A timer already running today is closed first (at now,
//   cut at the next break, Completed); a break inside the gap closes that
//   work at the break's start and the work carries on after it.
//   Stop: "Finished at" defaults to now (cut at the next break); an earlier
//   day's timer needs the end time (D10).
// Everything happens in ONE transaction under the day header lock — openDay /
// lockHeaderById take it FOR UPDATE — and the lines are re-read inside that
// lock (§20.3). Closing a timer is a conditional UPDATE … WHERE to_time IS
// NULL with the row count checked (§20.2).

import {
  type DayLogDetail,
  type DayLogSpan,
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
import { type DayLogClock, breakAt, dmy, istClock } from './rules';
import {
  breakName,
  guardOwnerWrite,
  hoursOf,
  ownerDetail,
  requireCompany,
  uniqueHit,
} from './writes';

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

/** Where a timer running from `startMin` stops if closed at `endMin`: at the
 *  first break after its start, with the note the screen shows. */
async function cutAtBreak(
  tx: DbTransaction,
  reportId: string,
  spans: readonly DayLogSpan[],
  startMin: number,
  endMin: number,
): Promise<{ end: number; note: string | null }> {
  const br = firstBreakInside(spans, startMin, endMin);
  if (!br) return { end: endMin, note: null };
  return {
    end: hhmmToMin(br.fromTime),
    note: `stopped at ${br.fromTime} for your ${await breakName(tx, reportId, br.fromTime)} break`,
  };
}

/** §20.2 — close the running line only if it is still running. */
async function closeLine(
  tx: DbTransaction,
  lineId: string,
  fromTime: string,
  endHm: string,
  status: string,
  note: string | null,
  user: AuthContext,
): Promise<void> {
  const updated = (await tx.execute(sql`
    UPDATE public.daily_report_lines
    SET to_time = ${endHm}::time, hours = ${hoursOf(fromTime, endHm)}, status = ${status},
        stop_note = ${note}, updated_at = now(), updated_by = ${user.id}::uuid
    WHERE id = ${lineId}::uuid AND to_time IS NULL AND deleted_at IS NULL
    RETURNING id
  `)) as unknown as unknown[];
  if (updated.length === 0) throw new ConflictError('This timer was already stopped — reload');
}

export async function startTimer(
  input: StartDayLogTimerInput,
  user: AuthContext,
  clock: DayLogClock = istClock(),
): Promise<DayLogDetail> {
  await requireCanWrite(user);
  const v = await loadViewer(user); // before the tx (ADR-229)
  const companyId = requireCompany(user);
  const date = clock.today;
  const now = clock.nowMin;
  const nowHm = minToHhmm(now);
  try {
    return await withUserContext(user, async (tx) => {
      // The day lock (§20.3): every Start / Stop on this day queues here.
      const h = await openDay(tx, companyId, user.id, date, user);
      await guardOwnerWrite(tx, companyId, h, clock.today);
      let lines = await loadLines(tx, companyId, h.id);
      let spans = spansOf(lines);

      const on = breakAt(spans, now);
      if (on) {
        const name = await breakName(tx, h.id, on.fromTime);
        throw new ConflictError(`You are on ${name} until ${on.toTime}`);
      }

      // b. A timer already running today closes first (Completed).
      const running = lines.find((l) => l.kind === 'work' && l.fromTime && !l.toTime);
      if (running) {
        const startMin = hhmmToMin(running.fromTime!);
        const cut = await cutAtBreak(tx, h.id, spans, startMin, now);
        if (cut.end <= startMin) {
          // Started this very minute: it never ran (the CHECK refuses a
          // 0-minute line), so it is replaced by the new work.
          const gone = (await tx.execute(sql`
            UPDATE public.daily_report_lines
            SET deleted_at = now(), deleted_by = ${user.id}::uuid, updated_at = now(),
                updated_by = ${user.id}::uuid
            WHERE id = ${running.id}::uuid AND to_time IS NULL AND deleted_at IS NULL
            RETURNING id
          `)) as unknown as unknown[];
          if (gone.length === 0) throw new ConflictError('This timer was already stopped — reload');
        } else {
          await closeLine(
            tx,
            running.id,
            running.fromTime!,
            minToHhmm(cut.end),
            'completed',
            cut.note,
            user,
          );
        }
        lines = await loadLines(tx, companyId, h.id);
        spans = spansOf(lines);
      }

      // d. From the server's nextFrom to now; a break in between closes the
      //    work at its start and the work carries on after it.
      let from = hhmmToMin(summarizeDay(spans).nextFrom);
      let lineNo = await nextLineNo(tx, h.id);
      for (let br = firstBreakInside(spans, from, now); br && from < now; ) {
        const breakStart = hhmmToMin(br.fromTime);
        if (breakStart <= from) {
          // nextFrom is always pushed past a break it falls into.
          throw new ConflictError('This day changed — reload and start again');
        }
        const fromHm = minToHhmm(from);
        await tx.execute(sql`
          INSERT INTO public.daily_report_lines
            (company_id, daily_report_id, line_no, description, kind, from_time, to_time,
             status, hours, stop_note, created_by, updated_by)
          VALUES (${companyId}::uuid, ${h.id}::uuid, ${lineNo}, ${input.description}, 'work',
                  ${fromHm}::time, ${br.fromTime}::time, 'completed', ${hoursOf(fromHm, br.fromTime)},
                  ${`stopped at ${br.fromTime} for your ${await breakName(tx, h.id, br.fromTime)} break`},
                  ${user.id}::uuid, ${user.id}::uuid)
        `);
        lineNo += 1;
        spans = [...spans, { kind: 'work', fromTime: fromHm, toTime: br.fromTime }];
        from = hhmmToMin(summarizeDay(spans).nextFrom); // past this break and any next to it
        br = firstBreakInside(spans, from, now);
      }
      if (from > now) {
        throw new ConflictError(`Work can be logged from ${minToHhmm(from)} — it is ${nowHm} now`);
      }

      await tx.execute(sql`
        INSERT INTO public.daily_report_lines
          (company_id, daily_report_id, line_no, description, kind, from_time, to_time,
           status, hours, created_by, updated_by)
        VALUES (${companyId}::uuid, ${h.id}::uuid, ${lineNo}, ${input.description},
                'work', ${minToHhmm(from)}::time, NULL, 'in_progress', 0,
                ${user.id}::uuid, ${user.id}::uuid)
      `);
      await touchDay(tx, h.id, user);
      return ownerDetail(tx, companyId, v, user, date, clock);
    });
  } catch (e) {
    if (uniqueHit(e)) throw new ConflictError('A timer is already running — reload');
    throw e;
  }
}

export async function stopTimer(
  input: StopDayLogTimerInput,
  user: AuthContext,
  clock: DayLogClock = istClock(),
): Promise<DayLogDetail> {
  await requireCanWrite(user);
  const v = await loadViewer(user); // before the tx (ADR-229)
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const found = await findRunning(tx, companyId, user.id);
    if (!found) throw new NotFoundError('No timer is running');
    // The day lock (§20.3).
    const h = await lockHeaderById(tx, companyId, found.reportId);
    if (!h) throw new NotFoundError('No timer is running');
    if (h.status !== 'open') throw notOpenError(h);
    const lines = await loadLines(tx, companyId, h.id);
    const line = lines.find((l) => l.id === found.id);
    if (!line || line.toTime) throw new ConflictError('This timer was already stopped — reload');
    const spans = spansOf(lines);
    const startMin = hhmmToMin(found.fromTime);
    const isToday = h.date === clock.today;

    let end: number;
    let note: string | null = null;
    if (isToday && !input.endTime) {
      // No "Finished at": now, cut at the first break after the start.
      ({ end, note } = await cutAtBreak(tx, h.id, spans, startMin, clock.nowMin));
      if (end <= startMin) {
        throw new ValidationError('The timer has not run a full minute — remove the entry instead');
      }
    } else {
      // "Finished at" today, or D10 — left running on an earlier day: the
      // owner says when work stopped.
      if (!input.endTime) {
        throw new ValidationError(`Give the time you stopped work on ${dmy(h.date)}`);
      }
      end = hhmmToMin(input.endTime);
      if (isToday && end > clock.nowMin) {
        throw new ValidationError(
          `${input.endTime} is later than now (${minToHhmm(clock.nowMin)})`,
        );
      }
      if (end <= startMin) throw new ValidationError(`Finished at must be after ${found.fromTime}`);
      const br = firstBreakInside(spans, startMin, end);
      if (br) {
        throw new ValidationError(
          `${await breakName(tx, h.id, br.fromTime)} ${br.fromTime}–${br.toTime} is inside — finish at ${br.fromTime} or earlier`,
        );
      }
    }
    await closeLine(tx, found.id, found.fromTime, minToHhmm(end), input.status, note, user);
    await touchDay(tx, h.id, user);
    return ownerDetail(tx, companyId, v, user, h.date, clock);
  });
}
