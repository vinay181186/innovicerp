// Day Log — what a Super Admin reads beyond the line: each entry's Entry Revs and
// replies, the replies on a day, and the entry as it is shown. One place for the
// person page (person-day.ts) and History (person-history.ts, ADR-278). Each
// fragment is a scalar sub-select, so it rides inside a bigger statement.

import type { DayLogAdminReply, DayLogEntryRevision, DayLogPersonDayEntry } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import { type DayLine, ts } from './day';
import { ADMIN_REPLY_COLS, toAdminReply } from './replies';
import { entryMinutes } from './rules';

type RevRow = DayLogEntryRevision & { lineId: string };

/** The SO / JWSO of a revision row (alias tr) as json, with its code — or null. */
const REV_ORDER = sql.raw(`CASE
  WHEN tr.sales_order_id IS NOT NULL THEN json_build_object(
    'type', 'so', 'id', tr.sales_order_id::text,
    'code', (SELECT s.code FROM public.sales_orders s
             WHERE s.id = tr.sales_order_id AND s.company_id = tr.company_id))
  WHEN tr.job_work_order_id IS NOT NULL THEN json_build_object(
    'type', 'jwso', 'id', tr.job_work_order_id::text,
    'code', (SELECT j.code FROM public.job_work_orders j
             WHERE j.id = tr.job_work_order_id AND j.company_id = tr.company_id))
  END`);

/** Every Entry Rev of the lines `ids` (a uuid[] expression), newest first per line. */
export const lineRevisionsJson = (companyId: string, ids: SQL): SQL => sql`(
  SELECT COALESCE(json_agg(json_build_object(
           'lineId', tr.line_id::text, 'entryRevNo', tr.entry_rev_no,
           'description', tr.description,
           'fromTime', to_char(tr.from_time, 'HH24:MI'),
           'toTime', to_char(tr.to_time, 'HH24:MI'),
           'order', ${REV_ORDER}, 'savedAt', ${ts('tr.saved_at')})
         ORDER BY tr.line_id, tr.entry_rev_no DESC), '[]'::json)
  FROM public.daily_report_line_revisions tr
  WHERE tr.company_id = ${companyId}::uuid AND tr.deleted_at IS NULL
    AND tr.line_id = ANY(${ids}))`;

/** Every reply on the lines `ids` (a uuid[] expression), oldest first. */
export const lineRepliesJson = (companyId: string, ids: SQL): SQL => sql`(
  SELECT COALESCE(json_agg(row_to_json(q) ORDER BY q.sent_at, q.id), '[]'::json) FROM (
    SELECT rp.line_id::text AS line_id, ${ADMIN_REPLY_COLS}
    FROM public.daily_report_line_replies rp
    JOIN public.users au ON au.id = rp.created_by
    WHERE rp.company_id = ${companyId}::uuid AND rp.deleted_at IS NULL
      AND rp.line_id = ANY(${ids})) q)`;

/** Every reply on the days matching `days` (over dr), oldest first, with report_date. */
export const dayRepliesAdminJson = (companyId: string, days: SQL): SQL => sql`(
  SELECT COALESCE(json_agg(row_to_json(q) ORDER BY q.sent_at, q.id), '[]'::json) FROM (
    SELECT to_char(dr.report_date, 'YYYY-MM-DD') AS report_date, ${ADMIN_REPLY_COLS}
    FROM public.daily_report_day_replies rp
    JOIN public.users au ON au.id = rp.created_by
    JOIN public.daily_reports dr ON dr.id = rp.daily_report_id
    WHERE rp.company_id = ${companyId}::uuid AND rp.deleted_at IS NULL AND ${days}) q)`;

/** Rows grouped by key, keeping their order. */
export function groupBy<T, V>(
  rows: readonly T[],
  keyOf: (r: T) => string,
  valueOf: (r: T) => V,
): Map<string, V[]> {
  const m = new Map<string, V[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const arr = m.get(k);
    if (arr) arr.push(valueOf(r));
    else m.set(k, [valueOf(r)]);
  }
  return m;
}

export interface LineFacts {
  revs: Map<string, RevRow[]>;
  replies: Map<string, DayLogAdminReply[]>;
}

/** lineRevisionsJson + lineRepliesJson → by line. `null`s read as none. */
export const lineFactsOf = (revs: unknown, replies: unknown, callerId: string): LineFacts => ({
  revs: groupBy(
    (revs ?? []) as RevRow[],
    (r) => r.lineId,
    (r) => r,
  ),
  replies: groupBy(
    (replies ?? []) as Array<Record<string, unknown>>,
    (q) => String(q['line_id']),
    (q) => toAdminReply(q, callerId),
  ),
});

/** A timed line as the person page shows it. `srNo` = its place by Start;
 *  `nowMin` only when its day is today. */
export function toPersonDayEntry(
  l: DayLine,
  srNo: number,
  facts: LineFacts,
  o: { nowMin: number | undefined; admin: boolean; canReply: boolean },
): DayLogPersonDayEntry {
  const lr = o.admin ? (facts.revs.get(l.id) ?? []) : [];
  const top = lr[0]; // newest first
  return {
    id: l.id,
    srNo,
    loggedAt: l.loggedAt,
    fromTime: l.fromTime!,
    toTime: l.toTime,
    minutes: entryMinutes(l.fromTime!, l.toTime, o.nowMin),
    order: l.order,
    description: l.description,
    entryRevNo: o.admin ? (top?.entryRevNo ?? 0) : null,
    entryRevisedAt: o.admin && top && top.entryRevNo > 0 ? top.savedAt : null,
    revisions: lr.map(({ entryRevNo, description, fromTime, toTime, order, savedAt }) => ({
      entryRevNo,
      description,
      fromTime,
      toTime,
      order,
      savedAt,
    })),
    replies: o.canReply ? (facts.replies.get(l.id) ?? []) : [],
  };
}
