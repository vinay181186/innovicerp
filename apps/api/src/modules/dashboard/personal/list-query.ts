// ADR-250 — the one shape every home list query returns, and the wrapper that
// pages it. Each list writes an INNER query producing the columns below; the
// wrapper adds the full count and the late count over EVERY matching row,
// sorts late first then oldest, and keeps the first page. The same inner query
// also answers "is this document still open?" for notifications and the
// Waiting block (ids / createdBy filters), so one predicate serves all three.

import { type SQL, sql } from 'drizzle-orm';
import type { DbTransaction } from '../../../db/with-user-context';
import { num, str } from './util';

/** First page of every home list (ADR-201: 25 a page). */
export const HOME_PAGE_SIZE = 25;

export interface ListFilter {
  /** Only these documents (notifications: "is it still open?"). */
  ids?: readonly string[];
  /** Only documents this user raised / received (Waiting block). */
  createdBy?: string;
  limit?: number;
}

/** Columns every inner query must produce (all text unless noted):
 *  row_key, id (doc uuid), code, kind, doc_date, due_date, sort_key, party,
 *  item_code, item_name, qty (numeric), uom, amount (numeric), created_by,
 *  is_late (int 0/1), x1, x2, x3 (list-specific extras). */
const COLS = sql.raw(
  'x.row_key, x.id, x.code, x.kind, x.doc_date, x.due_date, x.sort_key, x.party, ' +
    'x.item_code, x.item_name, x.qty, x.uom, x.amount, x.created_by, x.is_late, x.x1, x.x2, x.x3',
);

export interface RawRow {
  rowKey: string;
  id: string;
  code: string;
  kind: string | null;
  docDate: string | null;
  dueDate: string | null;
  party: string | null;
  itemCode: string | null;
  itemName: string | null;
  qty: number | null;
  uom: string | null;
  amount: number | null;
  createdBy: string | null;
  isLate: boolean;
  x1: string | null;
  x2: string | null;
  x3: string | null;
}

export interface ListResult {
  rows: RawRow[];
  total: number;
  lateTotal: number;
}

/** `AND <col> = ANY(ids)` / `AND <col> = createdBy` — parameterised. `col`
 *  is a fixed column reference written in this module, never user input. */
export function filterFrag(f: ListFilter, idCol: string, createdByCol: string | null): SQL {
  const parts: SQL[] = [];
  if (f.ids) parts.push(sql`AND ${sql.raw(idCol)} = ANY(${sql.param([...f.ids])}::uuid[])`);
  if (f.createdBy && createdByCol)
    parts.push(sql`AND ${sql.raw(createdByCol)} = ${f.createdBy}::uuid`);
  return parts.length ? sql.join(parts, sql` `) : sql``;
}

export async function runList(tx: DbTransaction, inner: SQL, f: ListFilter): Promise<ListResult> {
  if (f.ids && f.ids.length === 0) return { rows: [], total: 0, lateTotal: 0 };
  const limit = Math.max(1, Math.floor(f.limit ?? HOME_PAGE_SIZE));
  const res = (await tx.execute(sql`
    SELECT ${COLS},
           COUNT(*) OVER ()::int AS total_n,
           COALESCE(SUM(x.is_late) OVER (), 0)::int AS late_n
    FROM (${inner}) x
    ORDER BY x.is_late DESC, x.sort_key ASC NULLS LAST, x.code ASC, x.row_key ASC
    LIMIT ${limit}
  `)) as unknown as Array<Record<string, unknown>>;
  const rows: RawRow[] = res.map((r) => ({
    rowKey: String(r['row_key'] ?? r['id']),
    id: String(r['id']),
    code: String(r['code'] ?? ''),
    kind: str(r['kind']),
    docDate: str(r['doc_date']),
    dueDate: str(r['due_date']),
    party: str(r['party']),
    itemCode: str(r['item_code']),
    itemName: str(r['item_name']),
    qty: r['qty'] === null || r['qty'] === undefined ? null : num(r['qty']),
    uom: str(r['uom']),
    amount: r['amount'] === null || r['amount'] === undefined ? null : num(r['amount']),
    createdBy: str(r['created_by']),
    isLate: num(r['is_late']) > 0,
    x1: str(r['x1']),
    x2: str(r['x2']),
    x3: str(r['x3']),
  }));
  const first = res[0];
  return {
    rows,
    total: first ? num(first['total_n']) : 0,
    lateTotal: first ? num(first['late_n']) : 0,
  };
}
