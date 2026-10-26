// Day Log — the D3 check (an unfinished earlier working day), the stray
// Open entry on an earlier day, the entry shape and the whole DayLogDetail.

import {
  type DayLogDetail,
  type DayLogEntry,
  type DayLogStatus,
  type DayLogSummaryOut,
  fmt12,
  isWorkingDay,
  minToHhmm,
  summarizeDay,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';
import { ConflictError } from '../../lib/errors';
import { addDays } from '../dashboard/personal/util';
import { type DayUser, type Viewer, canManageUser, deptLabelOf } from './access';
import {
  type DayHeader,
  type DayLine,
  holidaysBetween,
  loadLines,
  readHeader,
  spansOf,
} from './day';
import { dmy, entryMinutes, istHm, lastEntryOf } from './rules';

/** How far back the D3 look-up walks for the previous working day. */
const LOOKBACK_DAYS = 40;
/**
 * D3 — the user's most recent working day before `date` must be finished
 * (submitted, Leave, or nothing missing). Never blocks someone with no day
 * before `date` at all (a new user).
 */
export async function findBlockedBy(
  tx: DbTransaction,
  companyId: string,
  userId: string,
  date: string,
): Promise<{ date: string; reason: string } | null> {
  // The "any earlier day" check and the holidays go in one pipelined trip.
  const [anyRows, hol] = await Promise.all([
    tx.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM public.daily_reports dr
      WHERE dr.company_id = ${companyId}::uuid AND dr.user_id = ${userId}::uuid
        AND dr.report_date < ${date}::date AND dr.deleted_at IS NULL
        -- an empty day (every entry removed) does not start the rule
        AND (dr.day_status <> 'open' OR EXISTS (
          SELECT 1 FROM public.daily_report_lines l
          WHERE l.daily_report_id = dr.id AND l.kind = 'work' AND l.deleted_at IS NULL))
    ) AS has
  `) as unknown as Promise<Array<{ has: boolean }>>,
    holidaysBetween(tx, companyId, addDays(date, -LOOKBACK_DAYS), addDays(date, -1)),
  ]);
  if (!anyRows[0]?.has) return null;

  const holDates = [...hol.keys()];
  let prev = addDays(date, -1);
  for (let i = 0; i < LOOKBACK_DAYS && !isWorkingDay(prev, holDates); i += 1)
    prev = addDays(prev, -1);

  // D3 — the day must be Submitted (or Leave), not merely filled.
  const h = await readHeader(tx, companyId, userId, prev);
  if (h && h.status !== 'open') return null;
  return {
    date: prev,
    reason: `${dmy(prev)} is not finished — complete and submit it, or ask your Department Admin to mark Leave`,
  };
}

/** An entry (work or break) left Open on a day before `today`. */
export async function findStrayOpen(
  tx: DbTransaction,
  companyId: string,
  userId: string,
  today: string,
): Promise<{ date: string; entryId: string; fromTime: string } | null> {
  const rows = (await tx.execute(sql`
    SELECT to_char(dr.report_date, 'YYYY-MM-DD') AS d, l.id::text AS id,
           to_char(l.from_time, 'HH24:MI') AS f
    FROM public.daily_report_lines l
    JOIN public.daily_reports dr ON dr.id = l.daily_report_id AND dr.deleted_at IS NULL
    WHERE dr.company_id = ${companyId}::uuid AND dr.user_id = ${userId}::uuid
      AND dr.report_date < ${today}::date
      AND l.to_time IS NULL AND l.from_time IS NOT NULL AND l.deleted_at IS NULL
    ORDER BY dr.report_date DESC LIMIT 1
  `)) as unknown as Array<{ d: string; id: string; f: string }>;
  const r = rows[0];
  return r ? { date: r.d, entryId: r.id, fromTime: r.f } : null;
}

/** `nowMin` only when the line's day is today (an Open entry counts to now). */
export function toEntry(l: DayLine, nowMin?: number): DayLogEntry {
  return {
    id: l.id,
    kind: l.kind,
    fromTime: l.fromTime ?? '',
    toTime: l.toTime,
    minutes: l.fromTime ? entryMinutes(l.fromTime, l.toTime, nowMin) : 0,
    description: l.description,
    order: l.order,
    remarks: l.remarks,
    late: l.late,
    updatedAt: l.updatedAt,
  };
}

/** summarizeDay + the LATE count — one reading for detail, team and person. */
export function summaryOf(
  lines: readonly DayLine[],
  nowMin: number | undefined,
  workingDay: boolean,
  status: DayLogStatus,
): DayLogSummaryOut {
  const s = summarizeDay(spansOf(lines), nowMin, workingDay);
  // Judged over the whole 09:00–18:00 window — the same test Submit uses —
  // so the screen never offers a Submit the server refuses (§20.5).
  const whole = summarizeDay(spansOf(lines), undefined, workingDay).unloggedMin;
  return {
    ...s,
    // Strict order: where the next entry must start (null while one is Open).
    // A Leave day owes no time.
    unloggedMin: status === 'leave' ? 0 : whole,
    lateCount: lines.filter((l) => l.late).length,
  };
}

/** The whole DayLogDetail for (target, date), as the viewer sees it. */
export async function buildDetail(
  tx: DbTransaction,
  companyId: string,
  v: Viewer,
  target: DayUser,
  date: string,
  clock: { today: string; nowMin: number },
): Promise<DayLogDetail> {
  // Independent reads, pipelined on the one connection (one round trip).
  const [header, hol, blockedBy, strayOpen] = await Promise.all([
    readHeader(tx, companyId, target.id, date),
    holidaysBetween(tx, companyId, date, date),
    findBlockedBy(tx, companyId, target.id, date),
    findStrayOpen(tx, companyId, target.id, clock.today),
  ]);
  const lines = header ? await loadLines(tx, companyId, header.id) : [];
  const holidayName = hol.get(date) ?? null;
  const workingDay = isWorkingDay(date, holidayName ? [date] : []);
  const nowMin = date === clock.today ? clock.nowMin : undefined;
  const status: DayLogStatus = header?.status ?? 'open';
  const summary = summaryOf(lines, nowMin, workingDay, status);

  const isOwner = target.id === v.userId;

  return {
    id: header?.id ?? null,
    userId: target.id,
    userName: target.name,
    deptLabel: deptLabelOf(target.mainDept),
    date,
    today: clock.today,
    nowTime: minToHhmm(clock.nowMin),
    status,
    workingDay,
    holidayName,
    entries: lines.filter((l) => l.fromTime).map((l) => toEntry(l, nowMin)),
    summary,
    submittedAt: header?.submittedAt ?? null,
    submittedByName: header?.submittedByName ?? null,
    reopenedAt: header?.reopenedAt ?? null,
    reopenedByName: header?.reopenedByName ?? null,
    reopenReason: header?.reopenReason ?? null,
    leaveReason: header?.leaveReason ?? null,
    blockedBy,
    strayOpen,
    isOwner,
    canWrite:
      isOwner &&
      v.writer &&
      status === 'open' &&
      !blockedBy &&
      date <= clock.today &&
      (!strayOpen || strayOpen.date === date),
    canManage: canManageUser(v, target.mainDept) && (!isOwner || v.isSuper),
    lastEntryId: lastEntryOf(lines.filter((l) => l.fromTime))?.id ?? null,
  };
}

/** 409 for a write on a day that is not open, naming who closed it and when. */
export function notOpenError(h: DayHeader): ConflictError {
  const at = (s: string | null): string => (s ? fmt12(istHm(s)) : '');
  if (h.status === 'submitted') {
    return new ConflictError(
      `${dmy(h.date)} was submitted by ${h.submittedByName ?? 'someone'} at ${at(h.submittedAt)} — ask your Department Admin to reopen it`,
    );
  }
  return new ConflictError(
    `${dmy(h.date)} is marked Leave by ${h.updatedByName ?? 'your Department Admin'} — ask your Department Admin to reopen it`,
  );
}
