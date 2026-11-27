// Day Log — Personal Leave (owner 2026-11-27). A person marks their OWN working
// days as Personal Leave: one date or a From–To range, past or future. Stored on
// the day header (daily_reports.day_status 'leave' + leave_reason, 0222 — no new
// table). The read side already treats a leave day as done (pending.ts, team.ts,
// person-day.ts, person-history.ts); entry writes refuse it (writes.ts
// guardNotLeave). Rules: DAY_LOG_LEAVE_RULES (packages/shared).
//   - Who: anyone who opens the Day Log page, a Super Admin included (part 2,
//     owner 2026-11-27) — never an Auditor (the page itself is checked by
//     resolveAccess). A Super Admin is still never pending (pending.ts
//     isPendingEligible), leave or not.
//   - When: from the person's Day Log start (PENDING_START_SQL) to today + 90,
//     at most 60 calendar days in one save.
//   - Sundays / company holidays get no header and are `skipped`; so are dates
//     already on leave (a repeated save is a no-op). A date with a live entry
//     refuses the WHOLE save.
//   - Part 2 (0268): Full Day (the above) or Half Day — ONE date with the
//     person's own From–To leave time (leave_kind 'half', leave_from/leave_to).
//     A Half Day is refused only when a live entry shares a minute with the
//     leave time (an Open entry on today counts up to now); entries outside it
//     stay. Later entries may not fall inside it (writes.ts validateEntry).
// ONE transaction: the first statement sets the claims and locks every working
// target day (lock.ts lockLeaveDays — same upsert as openDayLocked, §20.3), the
// second reads the days under that lock, then one conditional UPDATE.

import {
  DAY_LOG_LEAVE_RULES,
  HALF_DAY_WHOLE_DAY_MSG,
  halfCoversWholeDay,
  DAY_LOG_RULES,
  type DayLogLeaveDay,
  type DayLogLeaveInput,
  type DayLogLeaveList,
  type DayLogLeaveSetResult,
  fmt12,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { AuthorizationError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import {
  PENDING_START_SQL,
  type Viewer,
  accessJson,
  assertCanWrite,
  resolveAccess,
  viewerOf,
} from './access';
import { dayTx, lockLeaveDays, lockOwnDay } from './lock';
import { type DayLine, linesJson, toLines } from './day';
import { type DayLogClock, dmy, findOverlap, istClock } from './rules';
import { requireCompany } from './writes';

const DAY_MS = 86_400_000;

/** `date` + `n` calendar days (YYYY-MM-DD). */
export const addDays = (date: string, n: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** Every calendar date from `from` to `to`, oldest first. */
const datesBetween = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

/** May set Personal Leave: anyone on the Day Log page, a Super Admin included
 *  (part 2, owner 2026-11-27) — never an Auditor. The Day Log page itself was
 *  already checked by resolveAccess. getAccess's canSetLeave is this same rule
 *  (§20.5). */
export const canSetLeave = (v: Viewer): boolean => !v.auditor;

function requireLeaveRight(v: Viewer): void {
  if (!canSetLeave(v)) {
    throw new AuthorizationError('Personal Leave is not available to an Auditor.');
  }
}

type LeaveSpan = { fromTime: string; toTime: string };

/** "Personal Leave 05-12-2026" / "Half Day Leave 05-12-2026 01:00 PM – 06:00 PM"
 *  — the activity text of one save. */
const leaveLabel = (half: LeaveSpan | null, span: string): string =>
  half
    ? `Half Day Leave ${span} ${fmt12(half.fromTime)} – ${fmt12(half.toTime)}`
    : `Personal Leave ${span}`;

/** "05-12-2026" or "01-12-2026 – 03-12-2026". */
const spanText = (from: string, to: string): string =>
  from === to ? dmy(from) : `${dmy(from)} – ${dmy(to)}`;

/** GET /day-logs/leave/mine — the caller's own leave days, newest first. ONE statement. */
export async function getMyLeave(
  user: AuthContext,
  clock: DayLogClock = istClock(), // tests only — routes never pass it
): Promise<DayLogLeaveList> {
  const companyId = requireCompany(user);
  const [r] = (await db.execute(sql`
    SELECT ${accessJson(user.id, companyId)} AS access,
      (SELECT to_char(${PENDING_START_SQL}, 'YYYY-MM-DD') FROM public.users u
       WHERE u.id = ${user.id}::uuid AND u.company_id = ${companyId}::uuid) AS earliest,
      (SELECT COALESCE(json_agg(json_build_object(
                'date', to_char(dr.report_date, 'YYYY-MM-DD'), 'reason', COALESCE(dr.leave_reason, ''),
                'kind', dr.leave_kind,
                'fromTime', to_char(dr.leave_from, 'HH24:MI'), 'toTime', to_char(dr.leave_to, 'HH24:MI'))
              ORDER BY dr.report_date DESC), '[]'::json)
       FROM public.daily_reports dr
       WHERE dr.company_id = ${companyId}::uuid AND dr.user_id = ${user.id}::uuid
         AND dr.deleted_at IS NULL AND dr.day_status = 'leave') AS days
  `)) as unknown as Array<{
    access: unknown;
    earliest: string | null;
    days: DayLogLeaveDay[] | null;
  }>;
  await resolveAccess(user, r?.access);
  return {
    today: clock.today,
    earliest: r?.earliest ?? clock.today,
    latest: addDays(clock.today, DAY_LOG_LEAVE_RULES.maxDaysAhead),
    days: (r?.days ?? []).map((d) => ({
      date: d.date,
      reason: d.reason,
      kind: d.kind === 'half' ? ('half' as const) : ('full' as const),
      fromTime: d.kind === 'half' ? d.fromTime : null,
      toTime: d.kind === 'half' ? d.toTime : null,
    })),
  };
}

/** The inputs alone — before any DB trip. */
function checkInputBounds(input: DayLogLeaveInput, clock: DayLogClock): void {
  if (input.to < input.from) throw new ValidationError('To Date must be on or after From Date');
  const latest = addDays(clock.today, DAY_LOG_LEAVE_RULES.maxDaysAhead);
  if (input.to > latest) {
    throw new ValidationError(
      `${dmy(input.to)} is too far ahead — Personal Leave can be set up to ${dmy(latest)}`,
    );
  }
  const days = Math.round((Date.parse(input.to) - Date.parse(input.from)) / DAY_MS) + 1;
  if (days > DAY_LOG_LEAVE_RULES.maxRangeDays) {
    throw new ValidationError(
      `Personal Leave can cover at most ${DAY_LOG_LEAVE_RULES.maxRangeDays} days in one save`,
    );
  }
}

/** POST /day-logs/leave — mark the caller's working days from..to as Personal Leave. */
export async function setLeave(
  input: DayLogLeaveInput,
  user: AuthContext,
  clock: DayLogClock = istClock(), // tests only — routes never pass it
): Promise<DayLogLeaveSetResult> {
  const companyId = requireCompany(user);
  const reason = input.reason.trim();
  if (!reason) throw new ValidationError('Reason is required');
  checkInputBounds(input, clock);
  const half = halfOf(input);
  return dayTx(async (tx) => {
    // 1. Claims + the day lock on every working target date + access (§20.3).
    const locked = await lockLeaveDays(
      tx,
      user,
      companyId,
      input.from,
      input.to,
      DAY_LOG_RULES.workingWeekdays,
    );
    const eff = await resolveAccess(user, locked.access);
    assertCanWrite(eff);
    requireLeaveRight(viewerOf(user, eff));
    const earliest = locked.person?.pendingStart ?? input.from;
    if (input.from < earliest) {
      throw new ValidationError(
        `${dmy(input.from)} is before your Day Log start (${dmy(earliest)})`,
      );
    }
    const working = locked.dates;
    const nonWorking = datesBetween(input.from, input.to).filter((d) => !working.includes(d));
    // 2. The days, read under the lock.
    const days = await readDays(tx, companyId, user.id, working);
    // Half Day (one date): only an entry INSIDE the leave time refuses it; an
    // Open entry on today runs up to now. A day already on leave is skipped below.
    if (half) {
      for (const d of days) {
        if (d.status === 'leave') continue;
        const nowMin = d.date === clock.today ? clock.nowMin : undefined;
        const hit = findOverlap(spansOfLines(d.lines), half, nowMin);
        if (hit) {
          throw new ValidationError(
            `${dmy(d.date)} has an entry ${fmt12(hit.fromTime)} – ${hit.toTime ? fmt12(hit.toTime) : 'now'} inside the leave time — Personal Leave not set`,
          );
        }
      }
    }
    // Full Day: any live entry refuses the whole save.
    const withEntries = half ? [] : days.filter((d) => d.lines.length > 0).map((d) => d.date);
    if (withEntries.length === 1) {
      throw new ValidationError(
        `${dmy(withEntries[0]!)} already has entries — Personal Leave not set.`,
      );
    }
    if (withEntries.length > 1) {
      throw new ValidationError(
        `${withEntries.map(dmy).join(', ')} already have entries — Personal Leave not set.`,
      );
    }
    const already = days.filter((d) => d.status === 'leave').map((d) => d.date);
    const toSet = days.filter((d) => d.status !== 'leave');
    if (toSet.length === 0 && already.length === 0) {
      throw new ValidationError(
        input.from === input.to
          ? `${dmy(input.from)} is not a working day — nothing to set`
          : `No working days from ${dmy(input.from)} to ${dmy(input.to)} — nothing to set`,
      );
    }
    const skipped = [...nonWorking, ...already].sort();
    if (toSet.length === 0) return { set: [], skipped }; // a repeated save: no-op
    // 3. ONE conditional UPDATE (a day already on leave is left alone, §20.2).
    const rows = (await tx.execute(sql`
      UPDATE public.daily_reports
      SET day_status = 'leave', leave_reason = ${reason},
          leave_kind = ${half ? 'half' : 'full'},
          leave_from = ${half?.fromTime ?? null}::time, leave_to = ${half?.toTime ?? null}::time,
          updated_at = now(), updated_by = ${user.id}::uuid
      WHERE id = ANY(${sql.param(toSet.map((d) => d.id))}::uuid[])
        AND company_id = ${companyId}::uuid AND deleted_at IS NULL AND day_status <> 'leave'
      RETURNING id::text AS id, to_char(report_date, 'YYYY-MM-DD') AS date
    `)) as unknown as Array<{ id: string; date: string }>;
    const set = rows.map((x) => x.date).sort();
    await emitActivityLog(
      tx,
      {
        action: 'EDIT',
        entity: 'Day Log',
        entityId: rows.find((x) => x.date === set[0])?.id ?? toSet[0]!.id,
        refId: input.from,
        detail: `${leaveLabel(half, spanText(input.from, input.to))}: ${reason}`,
      },
      companyId,
      user,
    );
    return { set, skipped };
  });
}

/** The Half Day leave time of a save, else null (Full Day). The schema already
 *  refuses a Half Day without both times or over a range; re-checked because
 *  the service is the rule. */
function halfOf(input: DayLogLeaveInput): LeaveSpan | null {
  if (input.kind !== 'half') return null;
  if (!input.fromTime || !input.toTime || input.from !== input.to) {
    throw new ValidationError('Half Day is for one date, with its From Time and To Time');
  }
  if (input.toTime <= input.fromTime) throw new ValidationError('To Time must be after From Time');
  if (halfCoversWholeDay(input)) throw new ValidationError(HALF_DAY_WHOLE_DAY_MSG);
  return { fromTime: input.fromTime, toTime: input.toTime };
}

/** Timed lines → findOverlap's shape. */
const spansOfLines = (lines: readonly DayLine[]) =>
  lines
    .filter((l) => l.fromTime)
    .map((l) => ({
      id: l.id,
      kind: l.kind,
      fromTime: l.fromTime!,
      toTime: l.toTime,
      description: l.description,
    }));

interface LeaveDay {
  id: string;
  date: string;
  status: string;
  /** The day's live lines, read under the lock. */
  lines: DayLine[];
}

/** The caller's headers on `dates` with their status and their live lines. */
async function readDays(
  tx: DbTransaction,
  companyId: string,
  userId: string,
  dates: readonly string[],
): Promise<LeaveDay[]> {
  if (dates.length === 0) return [];
  const rows = (await tx.execute(sql`
    SELECT d0.id::text AS id, to_char(d0.report_date, 'YYYY-MM-DD') AS date,
      d0.day_status::text AS status,
      ${linesJson(companyId, sql`l.daily_report_id = d0.id`)} AS lines
    FROM public.daily_reports d0
    WHERE d0.company_id = ${companyId}::uuid AND d0.user_id = ${userId}::uuid
      AND d0.deleted_at IS NULL AND d0.report_date = ANY(${sql.param([...dates])}::date[])
    ORDER BY d0.report_date
  `)) as unknown as Array<{ id: string; date: string; status: string; lines: unknown }>;
  return rows.map((r) => ({ id: r.id, date: r.date, status: r.status, lines: toLines(r.lines) }));
}

/** DELETE /day-logs/leave/:date — the caller's own leave day back to open.
 *  Not on leave (or no header) → ok (idempotent, §20). */
export async function removeLeave(date: string, user: AuthContext): Promise<{ ok: true }> {
  const companyId = requireCompany(user);
  return dayTx(async (tx) => {
    // Claims + the day's row lock + access in one statement.
    const locked = await lockOwnDay(tx, user, companyId, date);
    const eff = await resolveAccess(user, locked.access);
    assertCanWrite(eff);
    requireLeaveRight(viewerOf(user, eff));
    const h = locked.header;
    if (!h || h.status !== 'leave') return { ok: true as const };
    const rows = (await tx.execute(sql`
      UPDATE public.daily_reports
      SET day_status = 'open', leave_reason = NULL,
          leave_kind = 'full', leave_from = NULL, leave_to = NULL,
          updated_at = now(), updated_by = ${user.id}::uuid
      WHERE id = ${h.id}::uuid AND deleted_at IS NULL AND day_status = 'leave'
      RETURNING id::text AS id
    `)) as unknown as Array<{ id: string }>;
    if (rows.length === 0) return { ok: true as const };
    await emitActivityLog(
      tx,
      {
        action: 'EDIT',
        entity: 'Day Log',
        entityId: h.id,
        refId: date,
        detail: `Removed ${h.leaveKind === 'half' ? 'Half Day Leave' : 'Personal Leave'} ${dmy(date)}`,
      },
      companyId,
      user,
    );
    return { ok: true as const };
  });
}
