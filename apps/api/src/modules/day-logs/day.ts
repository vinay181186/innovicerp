// Day Log — the day header and the line / holiday SQL every read shares.
// Reads are sub-selects returning json so one statement carries many facts
// (each round trip to the database is the cost — owner 2026-10-27). Writes
// lock the day through lock.ts.

import {
  DAY_LOG_RULES,
  type DayLogEntryKind,
  type DayLogOrder,
  type DayLogSpan,
  type DayLogStatus,
} from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import { hm } from './rules';

export interface DayHeader {
  id: string;
  userId: string;
  date: string;
  /** Kept for old days; the simple sheet no longer submits or reopens. */
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

/** An edit waiting for approval (0225). */
export interface PendingEdit {
  fromTime: string;
  toTime: string;
  description: string;
  order: DayLogOrder | null;
  /** ISO, as stored (ms) — the approve / reject guard compares it. */
  requestedAt: string;
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
  /** First saved more than lateAfterMin after its Stop. */
  late: boolean;
  updatedAt: string;
  /** Stored line_no. Absent only on a line that is not stored (a batch row being judged). */
  lineNo?: number;
  pending: PendingEdit | null;
  rejectReason: string | null;
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

/** A timestamptz as the ISO string iso() gives (ms truncated, like the
 *  driver's Date) — inside JSON, where the driver does not parse it. */
export const ts = (col: string): SQL =>
  sql.raw(`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

/**
 * LATE: FIRST saved (created_at) more than lateAfterMin after (report date +
 * Stop), India time. created_at, not updated_at: a saved row changes only by
 * an approved edit, and asking for / deciding an edit must not make it late.
 */
export const lateSql = (reportDate: SQL, toTime: SQL, createdAt: SQL): SQL => sql`
  (${toTime} IS NOT NULL AND ${createdAt} >
     ((${reportDate} + ${toTime}) AT TIME ZONE 'Asia/Kolkata')
     + make_interval(mins => ${DAY_LOG_RULES.lateAfterMin}::int))`;

/**
 * The live lines matching `where` as ONE json array (a scalar sub-select, so
 * it rides inside a bigger statement), in time order per day. `where` sees
 * l (line), dr (its day).
 */
export const linesJson = (companyId: string, where: SQL): SQL => sql`(
  SELECT COALESCE(json_agg(json_build_object(
           'id', l.id::text, 'report_id', l.daily_report_id::text, 'line_no', l.line_no,
           'kind', l.kind, 'from_time', to_char(l.from_time, 'HH24:MI'),
           'to_time', to_char(l.to_time, 'HH24:MI'), 'description', l.description,
           'remarks', l.remarks, 'updated_at', ${ts('l.updated_at')},
           'so_id', so.id::text, 'so_code', so.code, 'jw_id', jw.id::text, 'jw_code', jw.code,
           'late', ${lateSql(sql`dr.report_date`, sql`l.to_time`, sql`l.created_at`)},
           'p_from', to_char(l.pending_from, 'HH24:MI'), 'p_to', to_char(l.pending_to, 'HH24:MI'),
           'p_desc', l.pending_description, 'p_at', ${ts('l.pending_at')},
           'p_so_id', pso.id::text, 'p_so_code', pso.code,
           'p_jw_id', pjw.id::text, 'p_jw_code', pjw.code, 'reject_reason', l.reject_reason)
         ORDER BY l.daily_report_id, l.from_time NULLS LAST, l.line_no), '[]'::json)
  FROM public.daily_report_lines l
  JOIN public.daily_reports dr ON dr.id = l.daily_report_id
  LEFT JOIN public.sales_orders so ON so.id = l.sales_order_id
  LEFT JOIN public.job_work_orders jw ON jw.id = l.job_work_order_id
  LEFT JOIN public.sales_orders pso ON pso.id = l.pending_sales_order_id
  LEFT JOIN public.job_work_orders pjw ON pjw.id = l.pending_job_work_order_id
  WHERE l.company_id = ${companyId}::uuid AND l.deleted_at IS NULL AND ${where})`;

const orderOf = (r: Record<string, unknown>, p: string): DayLogOrder | null =>
  r[`${p}so_id`]
    ? { type: 'so', id: String(r[`${p}so_id`]), code: String(r[`${p}so_code`]) }
    : r[`${p}jw_id`]
      ? { type: 'jwso', id: String(r[`${p}jw_id`]), code: String(r[`${p}jw_code`]) }
      : null;

/** One element of linesJson → a DayLine. */
export function toLine(r: Record<string, unknown>): DayLine {
  return {
    id: String(r['id']),
    reportId: String(r['report_id']),
    kind: r['kind'] as DayLogEntryKind,
    fromTime: hm(r['from_time'] as string | null),
    toTime: hm(r['to_time'] as string | null),
    description: String(r['description'] ?? ''),
    remarks: (r['remarks'] as string | null) ?? null,
    order: orderOf(r, ''),
    late: r['late'] === true,
    updatedAt: iso(r['updated_at'])!,
    lineNo: Number(r['line_no'] ?? 0),
    pending: r['p_at']
      ? {
          fromTime: String(r['p_from']),
          toTime: String(r['p_to']),
          description: String(r['p_desc'] ?? ''),
          order: orderOf(r, 'p_'),
          requestedAt: String(r['p_at']),
        }
      : null,
    rejectReason: (r['reject_reason'] as string | null) ?? null,
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

/** Lines → the shared span shape. Every row counts as work now (the sheet
 *  has no Type); lines without a From — old Daily Task Report rows — carry
 *  no time and are left out. */
export function spansOf(lines: readonly DayLine[]): DayLogSpan[] {
  return (
    lines
      .filter((l) => l.fromTime)
      // The stored kind: old Break / Others rows never count as working hours.
      .map((l) => ({ kind: l.kind, fromTime: l.fromTime!, toTime: l.toTime }))
  );
}

/** Holidays in [from, to] as ONE json object { "YYYY-MM-DD": name } (a scalar sub-select). */
export const holidaysJson = (companyId: string, from: string, to: string): SQL => sql`(
  SELECT COALESCE(json_object_agg(to_char(holiday_date, 'YYYY-MM-DD'), name), '{}'::json)
  FROM public.company_holidays
  WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
    AND holiday_date BETWEEN ${from}::date AND ${to}::date)`;

export const toHolidays = (json: unknown): Map<string, string> =>
  new Map(Object.entries((json as Record<string, string> | null) ?? {}));
