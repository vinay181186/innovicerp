// Day Log — Personal Leave (owner 2026-11-27). A person marks their OWN working
// days as Personal Leave: one date or a From–To range, past or future. Stored on
// the day header (daily_reports.day_status 'leave' + leave_reason, 0222 — no new
// table). The read side already treats a leave day as done (pending.ts, team.ts,
// person-day.ts, person-history.ts); entry writes refuse it (writes.ts
// guardNotLeave). Rules: DAY_LOG_LEAVE_RULES (packages/shared).
//   - Who: anyone who keeps a Day Log — not a Super Admin, not an Auditor
//     (pending.ts isPendingEligible; the page itself is checked by resolveAccess).
//   - When: from the person's Day Log start (PENDING_START_SQL) to today + 90,
//     at most 60 calendar days in one save.
//   - Sundays / company holidays get no header and are `skipped`; so are dates
//     already on leave (a repeated save is a no-op). A date with a live entry
//     refuses the WHOLE save.
// ONE transaction: the first statement sets the claims and locks every working
// target day (lock.ts lockLeaveDays — same upsert as openDayLocked, §20.3), the
// second reads the days under that lock, then one conditional UPDATE.

import {
  DAY_LOG_LEAVE_RULES,
  DAY_LOG_RULES,
  type DayLogLeaveInput,
  type DayLogLeaveList,
  type DayLogLeaveSetResult,
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
import { type DayLogClock, dmy, istClock } from './rules';
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

/** May set Personal Leave: keeps a Day Log (not Super Admin, not Auditor). The
 *  Day Log page itself was already checked by resolveAccess. getAccess's
 *  canSetLeave is this same rule (§20.5). */
export const canSetLeave = (v: Viewer): boolean => !v.isSuper && !v.auditor;

function requireLeaveRight(v: Viewer): void {
  if (!canSetLeave(v)) {
    throw new AuthorizationError(
      'Personal Leave is only for people who keep a Day Log (not a Super Admin or Auditor).',
    );
  }
}

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
                'date', to_char(dr.report_date, 'YYYY-MM-DD'), 'reason', COALESCE(dr.leave_reason, ''))
              ORDER BY dr.report_date DESC), '[]'::json)
       FROM public.daily_reports dr
       WHERE dr.company_id = ${companyId}::uuid AND dr.user_id = ${user.id}::uuid
         AND dr.deleted_at IS NULL AND dr.day_status = 'leave') AS days
  `)) as unknown as Array<{
    access: unknown;
    earliest: string | null;
    days: Array<{ date: string; reason: string }> | null;
  }>;
  await resolveAccess(user, r?.access);
  return {
    today: clock.today,
    earliest: r?.earliest ?? clock.today,
    latest: addDays(clock.today, DAY_LOG_LEAVE_RULES.maxDaysAhead),
    days: r?.days ?? [],
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
    const withEntries = days.filter((d) => d.hasLines).map((d) => d.date);
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
        detail: `Personal Leave ${spanText(input.from, input.to)}: ${reason}`,
      },
      companyId,
      user,
    );
    return { set, skipped };
  });
}

interface LeaveDay {
  id: string;
  date: string;
  status: string;
  hasLines: boolean;
}

/** The caller's headers on `dates` with their status and whether a live line exists. */
async function readDays(
  tx: DbTransaction,
  companyId: string,
  userId: string,
  dates: readonly string[],
): Promise<LeaveDay[]> {
  if (dates.length === 0) return [];
  const rows = (await tx.execute(sql`
    SELECT dr.id::text AS id, to_char(dr.report_date, 'YYYY-MM-DD') AS date,
      dr.day_status::text AS status,
      EXISTS (SELECT 1 FROM public.daily_report_lines l
              WHERE l.daily_report_id = dr.id AND l.deleted_at IS NULL) AS has_lines
    FROM public.daily_reports dr
    WHERE dr.company_id = ${companyId}::uuid AND dr.user_id = ${userId}::uuid
      AND dr.deleted_at IS NULL AND dr.report_date = ANY(${sql.param([...dates])}::date[])
    ORDER BY dr.report_date
  `)) as unknown as Array<{ id: string; date: string; status: string; has_lines: boolean }>;
  return rows.map((r) => ({ id: r.id, date: r.date, status: r.status, hasLines: r.has_lines }));
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
        detail: `Removed Personal Leave ${dmy(date)}`,
      },
      companyId,
      user,
    );
    return { ok: true as const };
  });
}
