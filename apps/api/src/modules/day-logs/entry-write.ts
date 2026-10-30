// Day Log — what the entry writes share: one row's fields checked and
// resolved (prepare), the line write + header bump as ONE statement
// (writeLines) and the activity row. ADR-255/256: every save that changes a
// line adds its Entry Rev — the whole line after the save — in that same
// statement, through the ONE writer here (revisionAfter).

import { type DayLogOrder, type DayLogOrderType, fmt12 } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import { type DayHeader, type DayLine, lateSql, ts } from './day';
import { requireOpenOrder } from './orders';
import { type DayLogClock, dmy } from './rules';
import type { DaySnapshot } from './snapshot';
import { hoursOf, validateEntry } from './writes';

/** The fields of one row as the sheet / an edit sends them. */
export interface EntryFields {
  startTime: string;
  stopTime: string;
  description: string;
  orderType?: DayLogOrderType | null | undefined;
  orderId?: string | null | undefined;
}

/** The stored shape of one row's fields (kind is always 'work' now). */
export interface Row {
  fromTime: string;
  toTime: string;
  description: string;
  soId: string | null;
  jwId: string | null;
  orderCode: string | null;
}

/** The orders a request names — read with the snapshot, in the same statement. */
export const ordersOf = (
  rows: ReadonlyArray<{
    orderType?: DayLogOrderType | null | undefined;
    orderId?: string | null | undefined;
  }>,
): Array<{ type: DayLogOrderType; id: string }> =>
  rows.flatMap((r) => (r.orderType && r.orderId ? [{ type: r.orderType, id: r.orderId }] : []));

/** Validate one row under the lock against `others` (the day's other rows,
 *  current values) and resolve its order (409 unless it is open — an order
 *  the row already had is kept even if it closed since). */
export function prepare(
  date: string,
  others: readonly DayLine[],
  input: EntryFields,
  self: DayLine | null,
  clock: DayLogClock,
  snap: Pick<DaySnapshot, 'openOrders'>,
): Row {
  const orderType: DayLogOrderType | null = input.orderType ?? null;
  const orderId = input.orderId ?? null;
  if (!orderType !== !orderId) throw new ValidationError('Pick the SO / JWSO again');
  const description = input.description.trim();
  validateEntry(
    date,
    others,
    { fromTime: input.startTime, toTime: input.stopTime, description },
    clock,
  );
  let orderCode: string | null = null;
  if (orderType && orderId) {
    const kept = self?.order && self.order.type === orderType && self.order.id === orderId;
    orderCode = kept
      ? self.order!.code
      : requireOpenOrder(snap.openOrders, orderType, orderId).code;
  }
  return {
    fromTime: input.startTime,
    toTime: input.stopTime,
    description,
    soId: orderType === 'so' ? orderId : null,
    jwId: orderType === 'jwso' ? orderId : null,
    orderCode,
  };
}

export const label = (r: {
  fromTime: string;
  toTime: string | null;
  description: string;
}): string => `${fmt12(r.fromTime)}–${r.toTime ? fmt12(r.toTime) : 'Open'} ${r.description}`;

/** ADR-255 — Start–Stop and the SO / JWSO of a row, WITHOUT its Working On:
 *  the edit / approval activity text (activity_log is readable by every user,
 *  so no Working On edit may be recorded there). */
export const spanLabel = (
  r: { fromTime: string; toTime: string | null },
  orderCode: string | null,
): string =>
  `${fmt12(r.fromTime)}–${r.toTime ? fmt12(r.toTime) : 'Open'}${orderCode ? ` (${orderCode})` : ''}`;

export async function log(
  tx: DbTransaction,
  companyId: string,
  user: AuthContext,
  h: DayHeader,
  action: 'CREATE' | 'EDIT' | 'EDIT_APPROVED' | 'EDIT_REJECTED',
  detail: string,
): Promise<void> {
  await emitActivityLog(
    tx,
    {
      action,
      entity: 'Day Log',
      entityId: h.id,
      refId: h.date,
      detail: `Day Log ${dmy(h.date)}: ${detail}`,
    },
    companyId,
    user,
  );
}

/** What a line write hands back (RETURNING) — enough to rebuild the line. */
export interface Written {
  id: string;
  lineNo: number;
  updatedAt: string;
  late: boolean;
}

/**
 * ONE statement: `change` (an INSERT / UPDATE … RETURNING ${RETURNING}) and
 * the header bump that tells every screen (daily_reports is in Realtime).
 * `after` is an optional further write reading `w` (the changed lines) —
 * the Entry Rev (revisionAfter, ADR-255/256). A change that hits 0 rows returns [] — the
 * caller throws, and the whole transaction (bump included) rolls back.
 */
export async function writeLines(
  tx: DbTransaction,
  h: DayHeader,
  user: AuthContext,
  change: SQL,
  after?: SQL,
): Promise<Written[]> {
  const rows = (await tx.execute(sql`
    WITH w AS (${change}),
         ${after ? sql`a AS (${after}),` : sql``}
         t AS (UPDATE public.daily_reports SET updated_at = now(), updated_by = ${user.id}::uuid
               WHERE id = ${h.id}::uuid RETURNING 1)
    SELECT w.*, (SELECT count(*) FROM t)::int AS touched FROM w ORDER BY w.line_no
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r['id']),
    lineNo: Number(r['line_no']),
    updatedAt: String(r['updated_at']),
    late: r['late'] === true,
  }));
}

/** The RETURNING list of a line write (late as linesJson judges it). */
export const returning = (h: DayHeader): SQL => sql`
  id::text AS id, line_no, ${ts('updated_at')} AS updated_at,
  ${lateSql(sql`${h.date}::date`, sql`to_time`, sql`created_at`)} AS late`;

export const orderOfRow = (r: Row): DayLogOrder | null =>
  r.soId
    ? { type: 'so', id: r.soId, code: r.orderCode ?? '' }
    : r.jwId
      ? { type: 'jwso', id: r.jwId, code: r.orderCode ?? '' }
      : null;

/** A newly written Row as linesJson would now read it. */
export const lineOf = (r: Row, w: Written, reportId: string): DayLine => ({
  id: w.id,
  reportId,
  kind: 'work',
  fromTime: r.fromTime,
  toTime: r.toTime,
  description: r.description,
  remarks: null,
  order: orderOfRow(r),
  late: w.late,
  updatedAt: w.updatedAt,
  lineNo: w.lineNo,
  pending: null,
  rejectReason: null,
});

/** The RETURNING the revision writer (revisionAfter) reads from `w`: the
 *  line after the save. Every line write that adds an Entry Rev ends with it. */
export const REV_COLS = sql`company_id, created_at, description, from_time, to_time,
  sales_order_id, job_work_order_id`;

/** A line's values before a save (revisionAfter's "no Entry Rev yet" guard). */
export interface RevSnapshot {
  description: string;
  fromTime: string | null;
  toTime: string | null;
  order: DayLogOrder | null;
}

/**
 * ADR-256 — the ONE Entry Rev writer (new row, Working On edit, Start / Stop /
 * SO edit, approval of an old waiting edit). For every line `w` just wrote
 * (RETURNING ${REV_COLS}): Entry Rev max+1 = the whole line after the save
 * (a new line has none yet → Rev 0). `old` = the line before an EDIT: on a
 * line with no Entry Rev at all (should not happen after 0228, kept as a
 * guard) Rev 0 = those old values, saved when the line was, then Rev 1.
 * Runs under the day header lock; the unique (line_id, entry_rev_no) index
 * is the backstop.
 */
export function revisionAfter(userId: string, old?: RevSnapshot): SQL {
  const first = old
    ? sql`(0, ${old.description}::text, ${old.fromTime}::time, ${old.toTime}::time,
        ${old.order?.type === 'so' ? old.order.id : null}::uuid,
        ${old.order?.type === 'jwso' ? old.order.id : null}::uuid, w.created_at, mx.m = -1),`
    : sql``;
  const next = old ? sql`GREATEST(mx.m, 0) + 1` : sql`mx.m + 1`;
  return sql`
  INSERT INTO public.daily_report_line_revisions
    (company_id, line_id, entry_rev_no, description, from_time, to_time, sales_order_id,
     job_work_order_id, saved_at, created_by, updated_by)
  SELECT w.company_id, w.id::uuid, x.n, x.d, x.f, x.t, x.so, x.jw, x.s, ${userId}::uuid, ${userId}::uuid
  FROM w
  CROSS JOIN LATERAL (
    SELECT COALESCE(MAX(r.entry_rev_no), -1) AS m
    FROM public.daily_report_line_revisions r
    WHERE r.line_id = w.id::uuid AND r.deleted_at IS NULL) mx
  CROSS JOIN LATERAL (VALUES ${first}
    (${next}, w.description, w.from_time, w.to_time, w.sales_order_id, w.job_work_order_id,
     now(), true)) x(n, d, f, t, so, jw, s, keep)
  WHERE x.keep`;
}

/** Multi-row INSERT of new lines from line_no `first` on — pass
 *  revisionAfter(user.id) to writeLines with it (Entry Rev 0; its RETURNING
 *  carries REV_COLS). */
export function insertSql(
  companyId: string,
  h: DayHeader,
  user: AuthContext,
  rows: readonly Row[],
  first: number,
): SQL {
  const values = rows.map(
    (r, i) => sql`(${companyId}::uuid, ${h.id}::uuid, ${first + i}, ${r.description},
      'work', ${r.fromTime}::time, ${r.toTime}::time,
      'completed', ${hoursOf(r.fromTime, r.toTime)},
      NULL, ${r.soId}::uuid, ${r.jwId}::uuid, ${user.id}::uuid, ${user.id}::uuid)`,
  );
  return sql`
    INSERT INTO public.daily_report_lines
      (company_id, daily_report_id, line_no, description, kind, from_time, to_time,
       status, hours, remarks, sales_order_id, job_work_order_id, created_by, updated_by)
    VALUES ${sql.join(values, sql`, `)}
    RETURNING ${returning(h)}, ${REV_COLS}`;
}

/** Next line_no under the header lock (keeps daily_report_lines_line_uq). */
export const nextLineNo = (lines: readonly DayLine[]): number =>
  lines.reduce((m, l) => Math.max(m, l.lineNo ?? 0), 0) + 1;
