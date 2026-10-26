// Day Log — reading one day, opening it and locking it. Every write goes
// through openDay / readHeader(lock) / lockHeaderById, so the header row lock
// (§20.3) is taken in one place.

import {
  DAY_LOG_RULES,
  type DayLogEntryKind,
  type DayLogOrder,
  type DayLogSpan,
  type DayLogStatus,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { ConflictError } from '../../lib/errors';
import { hm } from './rules';

export interface DayHeader {
  id: string;
  userId: string;
  date: string;
  status: DayLogStatus;
  submittedAt: string | null;
  submittedByName: string | null;
  reopenedAt: string | null;
  reopenedByName: string | null;
  reopenReason: string | null;
  leaveReason: string | null;
  updatedAt: string;
  updatedByName: string | null;
}

export interface DayLine {
  id: string;
  reportId: string;
  kind: DayLogEntryKind;
  fromTime: string | null;
  toTime: string | null;
  description: string;
  remarks: string | null;
  order: DayLogOrder | null;
  /** Saved more than lateAfterMin after its Stop (never for an Open entry). */
  late: boolean;
  updatedAt: string;
}

export const iso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString()
      : new Date(String(v)).toISOString();

const HEADER_COLS = sql`
  dr.id::text AS id, dr.user_id::text AS user_id, to_char(dr.report_date, 'YYYY-MM-DD') AS date,
  dr.day_status AS status, dr.submitted_at, dr.reopened_at, dr.reopen_reason, dr.leave_reason,
  dr.updated_at,
  (SELECT COALESCE(u.full_name, u.email) FROM public.users u WHERE u.id = dr.submitted_by) AS submitted_by_name,
  (SELECT COALESCE(u.full_name, u.email) FROM public.users u WHERE u.id = dr.reopened_by) AS reopened_by_name,
  (SELECT COALESCE(u.full_name, u.email) FROM public.users u WHERE u.id = dr.updated_by) AS updated_by_name`;

function toHeader(r: Record<string, unknown>): DayHeader {
  return {
    id: String(r['id']),
    userId: String(r['user_id']),
    date: String(r['date']),
    status: r['status'] as DayLogStatus,
    submittedAt: iso(r['submitted_at']),
    submittedByName: (r['submitted_by_name'] as string | null) ?? null,
    reopenedAt: iso(r['reopened_at']),
    reopenedByName: (r['reopened_by_name'] as string | null) ?? null,
    reopenReason: (r['reopen_reason'] as string | null) ?? null,
    leaveReason: (r['leave_reason'] as string | null) ?? null,
    updatedAt: iso(r['updated_at'])!,
    updatedByName: (r['updated_by_name'] as string | null) ?? null,
  };
}

/** The live header of (user, date), optionally locked FOR UPDATE. */
export async function readHeader(
  tx: DbTransaction,
  companyId: string,
  userId: string,
  date: string,
  lock = false,
): Promise<DayHeader | null> {
  const rows = (await tx.execute(sql`
    SELECT ${HEADER_COLS}
    FROM public.daily_reports dr
    WHERE dr.company_id = ${companyId}::uuid AND dr.user_id = ${userId}::uuid
      AND dr.report_date = ${date}::date AND dr.deleted_at IS NULL
    ${lock ? sql`FOR UPDATE OF dr` : sql``}
  `)) as unknown as Array<Record<string, unknown>>;
  return rows[0] ? toHeader(rows[0]) : null;
}

/** Lock a header by id (§20.3 — every write takes this lock first). */
export async function lockHeaderById(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<DayHeader | null> {
  const rows = (await tx.execute(sql`
    SELECT ${HEADER_COLS}
    FROM public.daily_reports dr
    WHERE dr.id = ${id}::uuid AND dr.company_id = ${companyId}::uuid AND dr.deleted_at IS NULL
    FOR UPDATE OF dr
  `)) as unknown as Array<Record<string, unknown>>;
  return rows[0] ? toHeader(rows[0]) : null;
}

/**
 * Open (user, date) for writing: insert the header if it is missing (ON
 * CONFLICT on daily_reports_user_day_uq — two first entries at once open ONE
 * day), then lock it FOR UPDATE. Nothing is copied into a new day.
 */
export async function openDay(
  tx: DbTransaction,
  companyId: string,
  userId: string,
  date: string,
  actor: AuthContext,
): Promise<DayHeader> {
  await tx.execute(sql`
    INSERT INTO public.daily_reports (company_id, user_id, report_date, created_by, updated_by)
    VALUES (${companyId}::uuid, ${userId}::uuid, ${date}::date, ${actor.id}::uuid, ${actor.id}::uuid)
    ON CONFLICT (company_id, user_id, report_date) WHERE deleted_at IS NULL DO NOTHING
  `);
  const h = await readHeader(tx, companyId, userId, date, true);
  if (!h) throw new ConflictError('This day could not be opened — reload and try again');
  return h;
}

/** Bump the header so Realtime (daily_reports in LIVE_TABLES) tells every screen. */
export async function touchDay(tx: DbTransaction, id: string, actor: AuthContext): Promise<void> {
  await tx.execute(sql`
    UPDATE public.daily_reports SET updated_at = now(), updated_by = ${actor.id}::uuid
    WHERE id = ${id}::uuid
  `);
}

/** Next line_no under the header lock (keeps daily_report_lines_line_uq). */
export async function nextLineNo(tx: DbTransaction, reportId: string): Promise<number> {
  const [r] = (await tx.execute(sql`
    SELECT COALESCE(max(line_no), 0)::int + 1 AS n FROM public.daily_report_lines
    WHERE daily_report_id = ${reportId}::uuid AND deleted_at IS NULL
  `)) as unknown as Array<{ n: number }>;
  return Number(r?.n ?? 1);
}

/** The live lines of many days in ONE read, in time order per day. LATE:
 *  created more than lateAfterMin after (report date + Stop) in India time. */
export async function loadLinesFor(
  tx: DbTransaction,
  companyId: string,
  reportIds: readonly string[],
): Promise<DayLine[]> {
  if (reportIds.length === 0) return [];
  const rows = (await tx.execute(sql`
    SELECT l.id::text AS id, l.daily_report_id::text AS report_id, l.kind,
           to_char(l.from_time, 'HH24:MI') AS from_time, to_char(l.to_time, 'HH24:MI') AS to_time,
           l.description, l.remarks, l.updated_at,
           so.id::text AS so_id, so.code AS so_code, jw.id::text AS jw_id, jw.code AS jw_code,
           (l.to_time IS NOT NULL AND l.updated_at >
              ((dr.report_date + l.to_time) AT TIME ZONE 'Asia/Kolkata')
              + make_interval(mins => ${DAY_LOG_RULES.lateAfterMin}::int)) AS late
    FROM public.daily_report_lines l
    JOIN public.daily_reports dr ON dr.id = l.daily_report_id
    LEFT JOIN public.sales_orders so ON so.id = l.sales_order_id
    LEFT JOIN public.job_work_orders jw ON jw.id = l.job_work_order_id
    WHERE l.daily_report_id = ANY(${sql.param([...reportIds])}::uuid[])
      AND l.company_id = ${companyId}::uuid AND l.deleted_at IS NULL
    ORDER BY l.daily_report_id, l.from_time NULLS LAST, l.line_no
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => {
    const order: DayLogOrder | null = r['so_id']
      ? { type: 'so', id: String(r['so_id']), code: String(r['so_code']) }
      : r['jw_id']
        ? { type: 'jwso', id: String(r['jw_id']), code: String(r['jw_code']) }
        : null;
    return {
      id: String(r['id']),
      reportId: String(r['report_id']),
      kind: r['kind'] as DayLogEntryKind,
      fromTime: hm(r['from_time'] as string | null),
      toTime: hm(r['to_time'] as string | null),
      description: String(r['description'] ?? ''),
      remarks: (r['remarks'] as string | null) ?? null,
      order,
      late: r['late'] === true,
      updatedAt: iso(r['updated_at'])!,
    };
  });
}

/** One day's live lines, in time order. */
export function loadLines(
  tx: DbTransaction,
  companyId: string,
  reportId: string,
): Promise<DayLine[]> {
  return loadLinesFor(tx, companyId, [reportId]);
}

/** Lines → the shared span shape (lines without a From — old Daily Task
 *  Report rows — carry no time and are left out). */
export function spansOf(lines: readonly DayLine[]): DayLogSpan[] {
  return lines
    .filter((l) => l.fromTime)
    .map((l) => ({ kind: l.kind, fromTime: l.fromTime!, toTime: l.toTime }));
}

/** Holiday dates (and names) in [from, to]. */
export async function holidaysBetween(
  tx: DbTransaction,
  companyId: string,
  from: string,
  to: string,
): Promise<Map<string, string>> {
  const rows = (await tx.execute(sql`
    SELECT to_char(holiday_date, 'YYYY-MM-DD') AS d, name FROM public.company_holidays
    WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
      AND holiday_date BETWEEN ${from}::date AND ${to}::date
  `)) as unknown as Array<{ d: string; name: string }>;
  return new Map(rows.map((r) => [r.d, r.name]));
}
