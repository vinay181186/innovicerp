// Day Log — reading one day, opening it and locking it. Every write goes
// through openDay / readHeader(lock) / lockHeaderById, so the header row lock
// (§20.3) is taken in one place.

import { type DayLogSpan, type DayLogStatus } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { ConflictError } from '../../lib/errors';
import { hm } from './rules';

export interface DayHeader {
  id: string;
  userId: string;
  date: string;
  status: DayLogStatus;
  workFrom: string;
  workTo: string;
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
  kind: 'work' | 'break';
  fromTime: string | null;
  toTime: string | null;
  description: string;
  taskId: string | null;
  taskLabel: string | null;
  status: string;
  stopNote: string | null;
  updatedAt: string;
}

const iso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString()
      : new Date(String(v)).toISOString();

const HEADER_COLS = sql`
  dr.id::text AS id, dr.user_id::text AS user_id, to_char(dr.report_date, 'YYYY-MM-DD') AS date,
  dr.day_status AS status, to_char(dr.work_from, 'HH24:MI') AS work_from,
  to_char(dr.work_to, 'HH24:MI') AS work_to, dr.submitted_at, dr.reopened_at, dr.reopen_reason, dr.leave_reason,
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
    workFrom: String(r['work_from']),
    workTo: String(r['work_to']),
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
 * day), copy the user's break template into it when THIS call created it,
 * then lock it FOR UPDATE.
 */
export async function openDay(
  tx: DbTransaction,
  companyId: string,
  userId: string,
  date: string,
  actor: AuthContext,
): Promise<DayHeader> {
  const created = (await tx.execute(sql`
    INSERT INTO public.daily_reports (company_id, user_id, report_date, created_by, updated_by)
    VALUES (${companyId}::uuid, ${userId}::uuid, ${date}::date, ${actor.id}::uuid, ${actor.id}::uuid)
    ON CONFLICT (company_id, user_id, report_date) WHERE deleted_at IS NULL DO NOTHING
    RETURNING id::text AS id
  `)) as unknown as Array<{ id: string }>;
  const newId = created[0]?.id;
  if (newId) {
    await tx.execute(sql`
      INSERT INTO public.daily_report_lines
        (company_id, daily_report_id, line_no, description, kind, from_time, to_time,
         status, hours, created_by, updated_by)
      SELECT ${companyId}::uuid, ${newId}::uuid,
             row_number() OVER (ORDER BY b.sort_no, b.from_time), b.name, 'break',
             b.from_time, b.to_time, 'completed', 0, ${actor.id}::uuid, ${actor.id}::uuid
      FROM public.user_break_times b
      WHERE b.company_id = ${companyId}::uuid AND b.user_id = ${userId}::uuid
        AND b.deleted_at IS NULL
    `);
  }
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

/** The day's live lines, in time order. */
export async function loadLines(
  tx: DbTransaction,
  companyId: string,
  reportId: string,
): Promise<DayLine[]> {
  const rows = (await tx.execute(sql`
    SELECT l.id::text AS id, l.kind, to_char(l.from_time, 'HH24:MI') AS from_time,
           to_char(l.to_time, 'HH24:MI') AS to_time, l.description, l.task_id::text AS task_id,
           CASE WHEN t.id IS NULL THEN NULL ELSE t.code || ' · ' || t.title END AS task_label,
           l.status, l.stop_note, l.updated_at
    FROM public.daily_report_lines l
    LEFT JOIN public.tasks t ON t.id = l.task_id
    WHERE l.daily_report_id = ${reportId}::uuid AND l.company_id = ${companyId}::uuid
      AND l.deleted_at IS NULL
    ORDER BY l.from_time NULLS LAST, l.line_no
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r['id']),
    kind: r['kind'] as 'work' | 'break',
    fromTime: hm(r['from_time'] as string | null),
    toTime: hm(r['to_time'] as string | null),
    description: String(r['description'] ?? ''),
    taskId: (r['task_id'] as string | null) ?? null,
    taskLabel: (r['task_label'] as string | null) ?? null,
    status: String(r['status']),
    stopNote: (r['stop_note'] as string | null) ?? null,
    updatedAt: iso(r['updated_at'])!,
  }));
}

/** Lines → the shared span shape (lines without a From — old Daily Task
 *  Report rows — carry no time and are left out). */
export function spansOf(lines: readonly DayLine[]): DayLogSpan[] {
  return lines
    .filter((l) => l.fromTime)
    .map((l) => ({ kind: l.kind, fromTime: l.fromTime!, toTime: l.toTime }));
}

/** The user's break template as break spans (a day with no header yet). */
export async function templateBreaks(
  tx: DbTransaction,
  companyId: string,
  userId: string,
): Promise<DayLine[]> {
  const rows = (await tx.execute(sql`
    SELECT b.id::text AS id, b.name, to_char(b.from_time, 'HH24:MI') AS from_time,
           to_char(b.to_time, 'HH24:MI') AS to_time, b.updated_at
    FROM public.user_break_times b
    WHERE b.company_id = ${companyId}::uuid AND b.user_id = ${userId}::uuid AND b.deleted_at IS NULL
    ORDER BY b.sort_no, b.from_time
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r['id']),
    kind: 'break' as const,
    fromTime: String(r['from_time']),
    toTime: String(r['to_time']),
    description: String(r['name']),
    taskId: null,
    taskLabel: null,
    status: 'completed',
    stopNote: null,
    updatedAt: iso(r['updated_at'])!,
  }));
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
