// Day Log — what the entry writes share: one row's fields checked and
// resolved (prepare), the line write + header bump as ONE statement
// (writeLines) and the activity row.

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

export async function log(
  tx: DbTransaction,
  companyId: string,
  user: AuthContext,
  h: DayHeader,
  action: 'CREATE' | 'EDIT_REQUEST' | 'EDIT_APPROVED' | 'EDIT_REJECTED',
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
 * A change that hits 0 rows returns [] — the caller throws, and the whole
 * transaction (bump included) rolls back.
 */
export async function writeLines(
  tx: DbTransaction,
  h: DayHeader,
  user: AuthContext,
  change: SQL,
): Promise<Written[]> {
  const rows = (await tx.execute(sql`
    WITH w AS (${change}),
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

/** Multi-row INSERT of new lines from line_no `first` on. */
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
    RETURNING ${returning(h)}`;
}

/** Next line_no under the header lock (keeps daily_report_lines_line_uq). */
export const nextLineNo = (lines: readonly DayLine[]): number =>
  lines.reduce((m, l) => Math.max(m, l.lineNo ?? 0), 0) + 1;
