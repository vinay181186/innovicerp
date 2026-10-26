// Day Log — the D3 / D10 checks (an unfinished earlier working day; a timer
// left running on another day), the entry shape and the whole DayLogDetail.

import {
  type DayLogDetail,
  type DayLogEntry,
  type DayLogStatus,
  type DayLogWorkStatus,
  DAY_LOG_WORK_STATUSES,
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
  templateBreaks,
} from './day';
import { dmy, spanMinutes } from './rules';

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
  const [any] = (await tx.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM public.daily_reports dr
      WHERE dr.company_id = ${companyId}::uuid AND dr.user_id = ${userId}::uuid
        AND dr.report_date < ${date}::date AND dr.deleted_at IS NULL
        -- an empty day (e.g. opened only by a reminder) does not start the rule
        AND (dr.day_status <> 'open' OR EXISTS (
          SELECT 1 FROM public.daily_report_lines l
          WHERE l.daily_report_id = dr.id AND l.kind = 'work' AND l.deleted_at IS NULL))
    ) AS has
  `)) as unknown as Array<{ has: boolean }>;
  if (!any?.has) return null;

  const hol = await holidaysBetween(
    tx,
    companyId,
    addDays(date, -LOOKBACK_DAYS),
    addDays(date, -1),
  );
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

/** D10 — a work timer still running on a day before `today`. */
export async function findStrayTimer(
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
      AND l.kind = 'work' AND l.to_time IS NULL AND l.from_time IS NOT NULL
      AND l.deleted_at IS NULL
    ORDER BY dr.report_date DESC LIMIT 1
  `)) as unknown as Array<{ d: string; id: string; f: string }>;
  const r = rows[0];
  return r ? { date: r.d, entryId: r.id, fromTime: r.f } : null;
}

const isWorkStatus = (s: string): s is DayLogWorkStatus =>
  (DAY_LOG_WORK_STATUSES as readonly string[]).includes(s);

export function toEntry(l: DayLine): DayLogEntry {
  return {
    id: l.id,
    kind: l.kind,
    fromTime: l.fromTime ?? '',
    toTime: l.toTime,
    minutes: spanMinutes(l.fromTime, l.toTime),
    description: l.description,
    taskId: l.taskId,
    taskLabel: l.taskLabel,
    // Breaks carry no Work Status (stored 'completed', shown as none).
    status: l.kind === 'work' && isWorkStatus(l.status) ? l.status : null,
    stopNote: l.stopNote,
    updatedAt: l.updatedAt,
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
  const header = await readHeader(tx, companyId, target.id, date);
  const lines = header
    ? await loadLines(tx, companyId, header.id)
    : await templateBreaks(tx, companyId, target.id);
  const hol = await holidaysBetween(tx, companyId, date, date);
  const holidayName = hol.get(date) ?? null;
  const workingDay = isWorkingDay(date, holidayName ? [date] : []);
  const spans = spansOf(lines);
  const summary = summarizeDay(spans, date === clock.today ? clock.nowMin : undefined, workingDay);
  const status: DayLogStatus = header?.status ?? 'open';
  // A Leave day owes no time.
  if (status === 'leave') summary.missingMin = 0;

  const blockedBy = await findBlockedBy(tx, companyId, target.id, date);
  const strayTimer = await findStrayTimer(tx, companyId, target.id, clock.today);
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
    workFrom: header?.workFrom ?? '09:00',
    workTo: header?.workTo ?? '18:00',
    entries: lines.filter((l) => l.fromTime).map(toEntry),
    summary,
    submittedAt: header?.submittedAt ?? null,
    submittedByName: header?.submittedByName ?? null,
    reopenedAt: header?.reopenedAt ?? null,
    reopenedByName: header?.reopenedByName ?? null,
    reopenReason: header?.reopenReason ?? null,
    leaveReason: header?.leaveReason ?? null,
    blockedBy,
    strayTimer,
    isOwner,
    canWrite: isOwner && v.writer && status === 'open' && !blockedBy && date <= clock.today,
    canManage: canManageUser(v, target.mainDept),
  };
}

/** 409 for a write on a day that is not open, naming who closed it and when. */
export function notOpenError(h: DayHeader): ConflictError {
  const at = (s: string | null): string =>
    s ? new Date(new Date(s).getTime() + 5.5 * 3600 * 1000).toISOString().slice(11, 16) : '';
  if (h.status === 'submitted') {
    return new ConflictError(
      `${dmy(h.date)} was submitted by ${h.submittedByName ?? 'someone'} at ${at(h.submittedAt)} — ask your Department Admin to reopen it`,
    );
  }
  return new ConflictError(
    `${dmy(h.date)} is marked Leave by ${h.updatedByName ?? 'your Department Admin'} — ask your Department Admin to reopen it`,
  );
}
