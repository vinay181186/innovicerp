// Day Log — what the owner's entry writes share: one entry's fields checked
// and resolved (prepare), the line write + header bump as ONE statement
// (writeLines), the activity row and the open-entry race guard.

import {
  type AddDayLogEntryInput,
  type DayLogEntryKind,
  type DayLogOrder,
  type DayLogOrderType,
  fmt12,
} from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { ConflictError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import { type DayHeader, type DayLine, lateSql, ts } from './day';
import { requireOpenOrder } from './orders';
import { type DayLogClock, dmy } from './rules';
import type { DaySnapshot } from './snapshot';
import { hoursOf, uniqueHit, validateEntry } from './writes';

export type EntryFields = Omit<AddDayLogEntryInput, 'date'>;

/** The stored shape of one entry's fields. */
export interface Row {
  kind: DayLogEntryKind;
  description: string;
  fromTime: string;
  toTime: string | null;
  remarks: string | null;
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

/** Validate the fields under the lock and resolve the order (409 unless it is
 *  open — an order the entry already had is kept even if it closed since). */
export function prepare(
  h: DayHeader,
  lines: readonly DayLine[],
  input: EntryFields,
  self: DayLine | null,
  clock: DayLogClock,
  snap: DaySnapshot,
): Row {
  const toTime = input.stopTime ?? null;
  const others = lines.filter((l) => l.id !== self?.id);
  const orderType: DayLogOrderType | null = input.orderType ?? null;
  const orderId = input.orderId ?? null;
  const description = input.description || (input.kind === 'break' ? 'Break' : '');
  const remarks = input.remarks?.trim() || null;
  validateEntry(
    h,
    others,
    {
      kind: input.kind,
      fromTime: input.startTime,
      toTime,
      hasOrder: !!orderId,
      description,
      remarks,
    },
    self,
    clock,
    snap.openLines,
  );
  let orderCode: string | null = null;
  if (orderType && orderId) {
    const kept = self?.order && self.order.type === orderType && self.order.id === orderId;
    orderCode = kept
      ? self.order!.code
      : requireOpenOrder(snap.openOrders, orderType, orderId).code;
  }
  return {
    kind: input.kind,
    description,
    fromTime: input.startTime,
    toTime,
    remarks,
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
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'STOP',
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

/** A second Open entry racing past the code check hits daily_report_lines_open_uq. */
export async function guardUnique<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (uniqueHit(e)) throw new ConflictError('Another entry is already Open — reload');
    throw e;
  }
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

/** The RETURNING list of a line write (late as loadLines judges it). */
export const returning = (h: DayHeader): SQL => sql`
  id::text AS id, line_no, ${ts('updated_at')} AS updated_at,
  ${lateSql(sql`${h.date}::date`, sql`to_time`, sql`updated_at`)} AS late`;

export const orderOfRow = (r: Row): DayLogOrder | null =>
  r.soId
    ? { type: 'so', id: r.soId, code: r.orderCode ?? '' }
    : r.jwId
      ? { type: 'jwso', id: r.jwId, code: r.orderCode ?? '' }
      : null;

/** A written Row as the line loadLines would now read. */
export const lineOf = (r: Row, w: Written, reportId: string): DayLine => ({
  id: w.id,
  reportId,
  kind: r.kind,
  fromTime: r.fromTime,
  toTime: r.toTime,
  description: r.description,
  remarks: r.remarks,
  order: orderOfRow(r),
  late: w.late,
  updatedAt: w.updatedAt,
  lineNo: w.lineNo,
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
      ${r.kind}, ${r.fromTime}::time, ${r.toTime}::time,
      ${r.toTime ? 'completed' : 'in_progress'}, ${hoursOf(r.fromTime, r.toTime)},
      ${r.remarks}, ${r.soId}::uuid, ${r.jwId}::uuid, ${user.id}::uuid, ${user.id}::uuid)`,
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
