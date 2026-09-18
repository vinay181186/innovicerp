// Global Search — the per-kind registry TYPES and the tiny SQL helpers the two
// kind lists share. NO database imports: the registry is plain drizzle `sql`
// fragments so `query.ts` can render it without a connection.
//
// Every physical column name in kinds-docs.ts / kinds-registers.ts was checked
// against apps/api/src/db/schema.ts (snake_case names). Line tables all carry
// `deleted_at`, so the line EXISTS / lateral always filters on it.
//
// How a kind turns into a row (see query.ts):
//   docNo / party / status  → shown as-is and matched against the term
//   text[]                  → NOT shown; matched, and the first one that matched
//                             is returned as `hit`
//   shown[]                 → matched only (already visible via flatLines)
//   refs[] + refsJson       → "SO IN-SO-00012" style linked-doc entries, ONE
//                             entry each, first in `lines`; the raw value is matched
//   flatLines[]             → header-level particulars (item line, title, …)
//   lines                   → the line table: matched via EXISTS, and up to 3
//                             lines are appended ("+N more" after that); its
//                             `qty` column is SUMmed for the document qty

import { sql, type SQL } from 'drizzle-orm';
import type { GlobalSearchKind } from './schema';

export interface KindRef {
  /** Fixed prefix ("SO", "PO", "Vendor DC") or an SQL text expr (store issue's ref_type). */
  label: string | SQL;
  /** The code itself; NULL/'' means "no ref" and the entry is dropped. */
  expr: SQL;
}

export interface KindLines {
  /** Line table with alias `l` (plus any LEFT JOINs it needs for display). */
  from: SQL;
  /** FK back to the header, e.g. `l.sales_order_id`. */
  fk: SQL;
  /** One line's display text. */
  display: SQL;
  /** Columns the search term is matched against (all text). */
  match: SQL[];
  /** ORDER BY for "first 3 lines". */
  order: SQL;
  /** Per-line quantity column to SUM for the document qty; omit when none. */
  qty?: SQL;
}

export interface KindMeta {
  kind: GlobalSearchKind;
  /** FROM clause incl. alias `t` for the header and any LEFT JOINs (static SQL, no params). */
  from: SQL;
  docNo: SQL;
  /** Expression yielding a `date` (already cast), or null when the kind has no business date. */
  date: SQL | null;
  party: SQL | null;
  text: SQL[];
  shown?: SQL[];
  refs?: KindRef[];
  /** Extra jsonb array of ready-made ref strings (CAPA's nc_refs), placed before `refs`. */
  refsJson?: SQL;
  flatLines?: SQL[];
  lines?: KindLines;
  /** Header-level qty (a number column); ignored when `lines.qty` is set. */
  qty: SQL | null;
  status: SQL | null;
}

/** "CODE — Name", dropping a null/empty half; NULL when both are empty. */
export const pair = (a: SQL, b: SQL): SQL =>
  sql`NULLIF(concat_ws(' — ', NULLIF(${a}::text, ''), NULLIF(${b}::text, '')), '')`;

/** "op3 Turning" for a routing/plan/JC op line. */
export const opLine = (seq: SQL, operation: SQL): SQL =>
  sql`NULLIF(concat_ws(' ', 'op' || ${seq}::text, NULLIF(${operation}, '')), '')`;

export const ref = (label: string | SQL, expr: SQL): KindRef => ({ label, expr });

/** An "SO" ref whose column may actually hold a JWSO number (so_code_text, so_no,
 *  so_ref_text all do) — label it by the code's own prefix. The label is a plain SQL
 *  literal, not a bound param, so `label || ' ' || code` stays unambiguous. */
export const soRef = (expr: SQL): KindRef =>
  ref(sql`CASE WHEN ${expr} ILIKE 'IN-JW-%' THEN 'JWSO' ELSE 'SO' END`, expr);

/** Standard op-line table config (route_card_ops / plan_ops / jc_ops share the shape). */
export const opLines = (from: SQL, fk: SQL, extraMatch: SQL[]): KindLines => ({
  from,
  fk,
  display: opLine(sql`l.op_seq`, sql`l.operation`),
  match: [
    sql`l.operation`,
    sql`l.machine_code_text`,
    sql`l.program`,
    sql`l.tool_no`,
    ...extraMatch,
  ],
  order: sql`l.op_seq`,
});
