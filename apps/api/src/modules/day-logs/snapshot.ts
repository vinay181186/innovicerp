// Day Log — ONE statement that reads everything a day needs (owner
// 2026-10-27: each round trip to the database costs, so a day is one read):
// the viewer's access, the person, the header, its lines, the holidays of
// the D3 look-back, the earlier days D3 walks, every Open entry of the
// person (stray Open / "one Open at a time") and which of the asked SO /
// JWSO are still open. detail.ts and writes.ts judge it in memory.
//
// A write reads it AFTER taking the day lock (lock.ts), in its own
// statement, so the lines it validates are the ones under the lock (§20.3).

import type { DayLogOrderType, DayLogStatus } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';
import { db } from '../../db/client';
import { addDays } from '../dashboard/personal/util';
import { type DayUser, accessJson, dayUserJson, toDayUser } from './access';
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

/** How far back the D3 look-up walks for the previous working day. */
export const LOOKBACK_DAYS = 40;

/** An entry with a Start and no Stop, on any day of the person. */
export interface OpenLine {
  id: string;
  date: string;
  fromTime: string;
}

export interface DaySnapshot {
  /** The viewer's raw user_access json (resolveAccess) — null when not asked. */
  access: unknown;
  target: DayUser | null;
  header: DayHeader | null;
  lines: DayLine[];
  /** Holidays in [date − LOOKBACK_DAYS, date]. */
  holidays: Map<string, string>;
  /** D3 — any earlier day that starts the rule (submitted / leave / has work). */
  hasEarlier: boolean;
  /** Status of each live day in [date − LOOKBACK_DAYS − 1, date − 1]. */
  earlier: Map<string, DayLogStatus>;
  /** Every Open entry of the person, latest day first. */
  openLines: OpenLine[];
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
  return sql`
    SELECT
      ${ask.viewerId ? accessJson(ask.viewerId, co) : sql`NULL::json`} AS access,
      ${dayUserJson(co, uid)} AS target,
      (SELECT row_to_json(h) FROM (
         SELECT ${HEADER_COLS} FROM public.daily_reports dr
         WHERE ${day} AND dr.report_date = ${date}::date) h) AS header,
      ${linesJson(co, sql`${day} AND dr.report_date = ${date}::date`)} AS lines,
      ${holidaysJson(co, addDays(date, -LOOKBACK_DAYS), date)} AS holidays,
      EXISTS (
        SELECT 1 FROM public.daily_reports dr
        WHERE ${day} AND dr.report_date < ${date}::date
          -- an empty day (every entry removed) does not start the rule
          AND (dr.day_status <> 'open' OR EXISTS (
            SELECT 1 FROM public.daily_report_lines l
            WHERE l.daily_report_id = dr.id AND l.kind = 'work' AND l.deleted_at IS NULL))
      ) AS has_earlier,
      (SELECT COALESCE(json_object_agg(to_char(dr.report_date, 'YYYY-MM-DD'), dr.day_status), '{}'::json)
       FROM public.daily_reports dr
       WHERE ${day} AND dr.report_date BETWEEN ${addDays(date, -LOOKBACK_DAYS - 1)}::date
                                          AND ${addDays(date, -1)}::date) AS earlier,
      (SELECT COALESCE(json_agg(json_build_object(
                'id', l.id::text, 'date', to_char(dr.report_date, 'YYYY-MM-DD'),
                'fromTime', to_char(l.from_time, 'HH24:MI'))
              ORDER BY dr.report_date DESC, l.from_time DESC), '[]'::json)
       FROM public.daily_report_lines l
       JOIN public.daily_reports dr ON dr.id = l.daily_report_id
       WHERE ${day} AND l.to_time IS NULL AND l.from_time IS NOT NULL
         AND l.deleted_at IS NULL) AS open_lines,
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
    target: toDayUser(r['target']),
    header: r['header'] ? toHeader(r['header'] as Record<string, unknown>) : null,
    lines: toLines(r['lines']),
    holidays: toHolidays(r['holidays']),
    hasEarlier: r['has_earlier'] === true,
    earlier: new Map(Object.entries((r['earlier'] as Record<string, DayLogStatus> | null) ?? {})),
    openLines: (r['open_lines'] as OpenLine[] | null) ?? [],
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
