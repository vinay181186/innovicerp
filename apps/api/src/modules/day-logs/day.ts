// Day Log — the day header, the line / holiday SQL every read shares, and
// opening / locking one day. The owner's entry writes lock through lock.ts;
// Submit / Reopen / Leave through openDay / readHeader(lock) here (§20.3).
// Reads are sub-selects returning json so one statement carries many facts
// (each round trip to the database is the cost — owner 2026-10-27).

import {
  DAY_LOG_RULES,
  type DayLogEntryKind,
  type DayLogOrder,
  type DayLogSpan,
  type DayLogStatus,
} from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
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
  /** Stored line_no — the tie-break of the time order (lastEntryOf).
   *  Absent only on a line that is not stored (a batch row being judged). */
  lineNo?: number;
}

export const iso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString()
      : new Date(String(v)).toISOString();

export const HEADER_COLS = sql`
  dr.id::text AS id, dr.user_id::text AS user_id, to_char(dr.report_date, 'YYYY-MM-DD') AS date,
  dr.day_status AS status, dr.submitted_at, dr.reopened_at, dr.reopen_reason, dr.leave_reason,
  dr.updated_at,
  (SELECT COALESCE(u.full_name, u.email) FROM public.users u WHERE u.id = dr.submitted_by) AS submitted_by_name,
  (SELECT COALESCE(u.full_name, u.email) FROM public.users u WHERE u.id = dr.reopened_by) AS reopened_by_name,
  (SELECT COALESCE(u.full_name, u.email) FROM public.users u WHERE u.id = dr.updated_by) AS updated_by_name`;

export function toHeader(r: Record<string, unknown>): DayHeader {
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

/** A timestamptz as the ISO string iso() gives (ms truncated, like the
 *  driver's Date) — inside JSON, where the driver does not parse it. */
export const ts = (col: string): SQL =>
  sql.raw(`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

/** LATE: saved more than lateAfterMin after (report date + Stop), India time. */
export const lateSql = (reportDate: SQL, toTime: SQL, updatedAt: SQL): SQL => sql`
  (${toTime} IS NOT NULL AND ${updatedAt} >
     ((${reportDate} + ${toTime}) AT TIME ZONE 'Asia/Kolkata')
     + make_interval(mins => ${DAY_LOG_RULES.lateAfterMin}::int))`;

/**
 * The live lines matching `where` as ONE json array (a scalar sub-select, so
 * it rides inside a bigger statement), in time order per day. `where` sees
 * l (line), dr (its day), so / jw.
 */
export const linesJson = (companyId: string, where: SQL): SQL => sql`(
  SELECT COALESCE(json_agg(json_build_object(
           'id', l.id::text, 'report_id', l.daily_report_id::text, 'line_no', l.line_no,
           'kind', l.kind, 'from_time', to_char(l.from_time, 'HH24:MI'),
           'to_time', to_char(l.to_time, 'HH24:MI'), 'description', l.description,
           'remarks', l.remarks, 'updated_at', ${ts('l.updated_at')},
           'so_id', so.id::text, 'so_code', so.code, 'jw_id', jw.id::text, 'jw_code', jw.code,
           'late', ${lateSql(sql`dr.report_date`, sql`l.to_time`, sql`l.updated_at`)})
         ORDER BY l.daily_report_id, l.from_time NULLS LAST, l.line_no), '[]'::json)
  FROM public.daily_report_lines l
  JOIN public.daily_reports dr ON dr.id = l.daily_report_id
  LEFT JOIN public.sales_orders so ON so.id = l.sales_order_id
  LEFT JOIN public.job_work_orders jw ON jw.id = l.job_work_order_id
  WHERE l.company_id = ${companyId}::uuid AND l.deleted_at IS NULL AND ${where})`;

/** One element of linesJson → a DayLine. */
export function toLine(r: Record<string, unknown>): DayLine {
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
    lineNo: Number(r['line_no'] ?? 0),
  };
}

export const toLines = (json: unknown): DayLine[] =>
  ((json as Array<Record<string, unknown>> | null) ?? []).map(toLine);

/** Lines grouped by their day (report id). */
export function linesByReport(lines: readonly DayLine[]): Map<string, DayLine[]> {
  const by = new Map<string, DayLine[]>();
  for (const l of lines) {
    const arr = by.get(l.reportId) ?? [];
    arr.push(l);
    by.set(l.reportId, arr);
  }
  return by;
}

/** The SQL order (From, NULLs last, then line_no) — for lines changed in memory. */
export const inTimeOrder = (lines: readonly DayLine[]): DayLine[] =>
  [...lines].sort((a, b) =>
    a.fromTime === b.fromTime
      ? (a.lineNo ?? 0) - (b.lineNo ?? 0)
      : a.fromTime === null
        ? 1
        : b.fromTime === null
          ? -1
          : a.fromTime < b.fromTime
            ? -1
            : 1,
  );

/** The live lines of many days in ONE read, in time order per day. */
export async function loadLinesFor(
  tx: DbTransaction,
  companyId: string,
  reportIds: readonly string[],
): Promise<DayLine[]> {
  if (reportIds.length === 0) return [];
  const [r] = (await tx.execute(sql`
    SELECT ${linesJson(companyId, sql`l.daily_report_id = ANY(${sql.param([...reportIds])}::uuid[])`)} AS lines
  `)) as unknown as Array<{ lines: unknown }>;
  return toLines(r?.lines);
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

/** Holidays in [from, to] as ONE json object { "YYYY-MM-DD": name } (a scalar sub-select). */
export const holidaysJson = (companyId: string, from: string, to: string): SQL => sql`(
  SELECT COALESCE(json_object_agg(to_char(holiday_date, 'YYYY-MM-DD'), name), '{}'::json)
  FROM public.company_holidays
  WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
    AND holiday_date BETWEEN ${from}::date AND ${to}::date)`;

export const toHolidays = (json: unknown): Map<string, string> =>
  new Map(Object.entries((json as Record<string, string> | null) ?? {}));
