// Day Log — ONE statement that reads everything a day needs (owner
// 2026-10-27: each round trip to the database costs, so a day is one read):
// the viewer's access, the person, the header, its lines, the day's holiday,
// the two facts of "yesterday first" and which of the asked SO / JWSO are
// still open. detail.ts and writes.ts judge it in memory.
//
// A write reads it AFTER taking the day lock (lock.ts), in its own
// statement, so the lines it validates are the ones under the lock (§20.3).

import type { DayLogOrderType } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';
import { db } from '../../db/client';
import { addDays } from '../dashboard/personal/util';
import { type DayUser, accessJson, dayUserJson, matesJson, toDayUser } from './access';
import {
  type DayHeader,
  type DayLine,
  HEADER_COLS,
  holidaysJson,
  linesJson,
  toHeader,
  toHolidays,
  toLines,
} from './day';

export interface DaySnapshot {
  /** The viewer's raw user_access json (resolveAccess) — null when not asked. */
  access: unknown;
  /** The viewer's Teams Config mates json (viewerOf) — null when not asked. */
  mates: unknown;
  target: DayUser | null;
  header: DayHeader | null;
  lines: DayLine[];
  /** The holiday on `date` (0 or 1 entry). */
  holidays: Map<string, string>;
  /** Yesterday first — the person has a saved row on some day before `date`. */
  hasEarlier: boolean;
  /** … and on the calendar day before `date`. */
  prevHasRows: boolean;
  /** Asked orders that are open: "so:<id>" / "jwso:<id>" → code. */
  openOrders: Map<string, string>;
}

export interface SnapshotAsk {
  companyId: string;
  /** Whose access to read (null = do not read it). */
  viewerId: string | null;
  targetId: string;
  date: string;
  orders?: ReadonlyArray<{ type: DayLogOrderType; id: string }>;
  /** ADR-255 — read each line's replies (only where they are shown: the
   *  owner's own day and its write responses). Default: not read. */
  replies?: boolean;
}

const idsOf = (ask: SnapshotAsk, type: DayLogOrderType): string[] => [
  ...new Set((ask.orders ?? []).filter((o) => o.type === type).map((o) => o.id)),
];

function openOrdersSql(table: string, ids: string[], companyId: string): SQL {
  if (ids.length === 0) return sql`'{}'::json`;
  return sql`(
    SELECT COALESCE(json_object_agg(o.id::text, o.code), '{}'::json) FROM ${sql.raw(table)} o
    WHERE o.id = ANY(${sql.param(ids)}::uuid[]) AND o.company_id = ${companyId}::uuid
      AND o.deleted_at IS NULL AND o.status = 'open')`;
}

/** The one statement. `head` is put in front of the column list (claims). */
export function snapshotSql(ask: SnapshotAsk): SQL {
  const { companyId: co, targetId: uid, date } = ask;
  const day = sql`dr.company_id = ${co}::uuid AND dr.user_id = ${uid}::uuid AND dr.deleted_at IS NULL`;
  // A saved Day Log row (old untimed Daily Task Report lines do not count).
  const timedLine = sql`FROM public.daily_report_lines l
    JOIN public.daily_reports dr ON dr.id = l.daily_report_id
    WHERE ${day} AND l.deleted_at IS NULL AND l.from_time IS NOT NULL`;
  return sql`
    SELECT
      ${ask.viewerId ? accessJson(ask.viewerId, co) : sql`NULL::json`} AS access,
      ${ask.viewerId ? matesJson(ask.viewerId, co) : sql`NULL::json`} AS mates,
      ${dayUserJson(co, uid)} AS target,
      (SELECT row_to_json(h) FROM (
         SELECT ${HEADER_COLS} FROM public.daily_reports dr
         WHERE ${day} AND dr.report_date = ${date}::date) h) AS header,
      ${linesJson(co, sql`${day} AND dr.report_date = ${date}::date`, ask.replies === true)} AS lines,
      ${holidaysJson(co, date, date)} AS holidays,
      EXISTS (SELECT 1 ${timedLine} AND dr.report_date < ${date}::date) AS has_earlier,
      EXISTS (SELECT 1 ${timedLine} AND dr.report_date = ${addDays(date, -1)}::date) AS prev_has_rows,
      ${openOrdersSql('public.sales_orders', idsOf(ask, 'so'), co)} AS so_open,
      ${openOrdersSql('public.job_work_orders', idsOf(ask, 'jwso'), co)} AS jw_open
  `;
}

export function toSnapshot(r: Record<string, unknown>): DaySnapshot {
  const openOrders = new Map<string, string>();
  for (const [id, code] of Object.entries((r['so_open'] as Record<string, string>) ?? {}))
    openOrders.set(`so:${id}`, code);
  for (const [id, code] of Object.entries((r['jw_open'] as Record<string, string>) ?? {}))
    openOrders.set(`jwso:${id}`, code);
  return {
    access: r['access'] ?? null,
    mates: r['mates'] ?? null,
    target: toDayUser(r['target']),
    header: r['header'] ? toHeader(r['header'] as Record<string, unknown>) : null,
    lines: toLines(r['lines']),
    holidays: toHolidays(r['holidays']),
    hasEarlier: r['has_earlier'] === true,
    prevHasRows: r['prev_has_rows'] === true,
    openOrders,
  };
}

/** Read the snapshot — on `tx` (inside a write) or as one plain statement. */
export async function readSnapshot(ask: SnapshotAsk, tx?: DbTransaction): Promise<DaySnapshot> {
  const q = snapshotSql(ask);
  const rows = (await (tx ? tx.execute(q) : db.execute(q))) as unknown as Array<
    Record<string, unknown>
  >;
  return toSnapshot(rows[0]!);
}
