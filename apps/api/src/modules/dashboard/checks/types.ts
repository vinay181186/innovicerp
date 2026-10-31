// ADR-262 — department checks on the new home: the shape every check
// declares, the runner, and the pure helpers (IST windows, row status).
//
// A check's query is a list-query.ts INNER query (same columns as the
// ADR-250 home lists), so the per-person home and the checks reuse ONE
// predicate per fact: rows-*.ts are imported, never copied. The runner is
// list-query.ts runList plus one more window figure: how many rows are due
// TODAY (the check's orange tone). Rows: late first, then oldest.

import {
  type DashCheck,
  type DashCheckDept,
  type DashCheckKey,
  type DashCheckRow,
  type DashTone,
  DASH_CHECK_ROW_LIMIT,
} from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import type { DbTransaction } from '../../../db/with-user-context';
import type { RawRow } from '../personal/list-query';
import { addDays, dayDiff, num, plural, shortDate, str } from '../personal/util';

export interface CheckCtx {
  cid: string;
  /** Today, India time (YYYY-MM-DD). */
  today: string;
}

export interface CheckDef {
  key: DashCheckKey;
  dept: DashCheckDept;
  label: string;
  /** [document, reference, date] — names per docs/NAMING.md. */
  head: DashCheck['head'];
  /** "View all" page; the check is shown only if it opens for the caller. */
  href: string;
  query: (c: CheckCtx) => SQL;
  docHref: (r: RawRow) => string;
  refCode?: (r: RawRow) => string | null;
  refHref?: (r: RawRow) => string | null;
  /** The row's date is a deadline (due_date) — or, when false, the document's
   *  own date and the status reads its age. */
  dated: boolean;
  /** Status words when the row's state, not its date, is the news. */
  statusText?: (r: RawRow) => string | null;
  /** Qty is not a quantity on this check (e.g. a Route Card's op count). */
  noQty?: true;
}

// ── IST windows (Monday-start week, CLAUDE.md §6.5: never CURRENT_DATE) ──

/** The Sunday that ends today's week (today itself on a Sunday). */
export function weekEnd(today: string): string {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(today, (7 - dow) % 7);
}

/** The last day of today's month. */
export function monthEnd(today: string): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

// ── Row status ──

/** Status words + colour of one row. Late = the query's is_late (the same
 *  test the row was counted with); due = deadline today; else ok. */
export function rowStatus(
  d: Pick<CheckDef, 'dated' | 'statusText'>,
  r: RawRow,
  today: string,
): { statusLabel: string; tone: DashTone } {
  const due = d.dated ? r.dueDate : null;
  const tone: DashTone = r.isLate ? 'late' : due && due === today ? 'due' : 'ok';
  const fixed = d.statusText?.(r) ?? null;
  if (fixed) return { statusLabel: fixed, tone };
  if (due) {
    const diff = dayDiff(today, due);
    if (diff < 0) return { statusLabel: `${plural(-diff, 'day')} late`, tone };
    if (diff === 0) return { statusLabel: 'Due today', tone };
    return { statusLabel: `Due ${shortDate(due)}`, tone };
  }
  if (r.isLate) return { statusLabel: 'Late', tone };
  const since = r.docDate;
  if (!since) return { statusLabel: '', tone };
  const age = Math.max(0, dayDiff(since, today));
  return { statusLabel: age === 0 ? 'Today' : `Waiting ${plural(age, 'day')}`, tone };
}

/** The check's own colour: late if any row is late, else due if any row is
 *  due today, else ok. Counted over EVERY matching row, not the first page. */
export function checkTone(lateTotal: number, dueTodayTotal: number): DashTone {
  if (lateTotal > 0) return 'late';
  if (dueTodayTotal > 0) return 'due';
  return 'ok';
}

// ── Runner ──

const COLS = sql.raw(
  'x.row_key, x.id, x.code, x.kind, x.doc_date, x.due_date, x.sort_key, x.party, ' +
    'x.item_code, x.item_name, x.qty, x.uom, x.amount, x.created_by, x.is_late, x.x1, x.x2, x.x3',
);

/** `inner` narrowed by `where` (a condition over the inner columns, alias x),
 *  keeping the list-query column set — for "the same rule, plus …" checks. */
export function narrow(inner: SQL, where: SQL): SQL {
  return sql`SELECT ${COLS} FROM (${inner}) x WHERE ${where}`;
}

export interface CheckResult {
  rows: RawRow[];
  total: number;
  lateTotal: number;
  dueTodayTotal: number;
}

export async function runCheck(
  tx: DbTransaction,
  inner: SQL,
  today: string,
  limit = DASH_CHECK_ROW_LIMIT,
): Promise<CheckResult> {
  const res = (await tx.execute(sql`
    SELECT ${COLS},
           COUNT(*) OVER ()::int AS total_n,
           COALESCE(SUM(x.is_late) OVER (), 0)::int AS late_n,
           COUNT(*) FILTER (WHERE x.is_late = 0 AND x.due_date = ${today}) OVER ()::int AS due_n
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
    amount: null,
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
    dueTodayTotal: first ? num(first['due_n']) : 0,
  };
}

/** One raw row → the contract row. */
export function toCheckRow(d: CheckDef, r: RawRow, today: string): DashCheckRow {
  const { statusLabel, tone } = rowStatus(d, r, today);
  return {
    key: `${d.key}:${r.rowKey}`,
    docCode: r.code,
    docHref: d.docHref(r),
    refCode: d.refCode?.(r) ?? null,
    refHref: d.refHref?.(r) ?? null,
    party: r.party,
    itemCode: r.itemCode,
    itemName: r.itemName,
    qty: d.noQty ? null : r.qty,
    uom: d.noQty ? null : r.uom,
    checkDate: (d.dated ? r.dueDate : r.docDate)?.slice(0, 10) ?? null,
    statusLabel,
    tone,
  };
}

export function toCheck(d: CheckDef, res: CheckResult, today: string): DashCheck {
  return {
    key: d.key,
    dept: d.dept,
    label: d.label,
    count: res.total,
    // An undated check (approvals, QC) has no deadline: never orange.
    tone: checkTone(res.lateTotal, d.dated ? res.dueTodayTotal : 0),
    head: d.head,
    rows: res.rows.map((r) => toCheckRow(d, r, today)),
    href: d.href,
  };
}
