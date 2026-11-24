import { sql, type SQL } from 'drizzle-orm';

// ADR-316 — the ONE order a Purchase Request belongs to, for "one PO = one
// order". Same precedence as PR_ORDER_CODE (purchase-requests/sf-columns.ts),
// which is what the SO No. column shows: the PR's own SO, else its Job Card's
// JWSO, else the Job Card's SO, else none. Keyed by ids, never codes, so a
// renamed SO (ADR-306) cannot split or merge two orders.
//
// Correlated scalar subqueries off the PR alias the caller names: no join is
// added to the caller's query, so no row can multiply. Aliases are k_-prefixed
// so they never clash with the list query's own (so, sol, jc, rev_jwl).

const ALIAS = /^[a-z_][a-z0-9_]*$/;

function orderOf(pr: string, soVal: (so: string) => string, jwVal: string, last: string): SQL {
  if (!ALIAS.test(pr)) throw new Error(`pr-order-key: bad alias "${pr}"`);
  return sql.raw(
    `COALESCE(` +
      // 1. The PR's own SO line → live SO.
      `(SELECT ${soVal('k_so')} FROM public.sales_order_lines k_sol` +
      ` JOIN public.sales_orders k_so ON k_so.id = k_sol.sales_order_id AND k_so.deleted_at IS NULL` +
      ` WHERE k_sol.id = ${pr}.source_so_line_id AND k_sol.deleted_at IS NULL),` +
      // 2. The PR's Job Card op → card → JW line → live JWSO.
      ` (SELECT ${jwVal} FROM public.jc_ops k_jo` +
      ` JOIN public.job_cards k_jc ON k_jc.id = k_jo.job_card_id AND k_jc.deleted_at IS NULL` +
      ` JOIN public.job_work_order_lines k_jwl ON k_jwl.id = k_jc.source_jw_line_id AND k_jwl.deleted_at IS NULL` +
      ` JOIN public.job_work_orders k_jw ON k_jw.id = k_jwl.job_work_order_id AND k_jw.deleted_at IS NULL` +
      ` WHERE k_jo.id = ${pr}.source_jc_op_id AND k_jo.deleted_at IS NULL),` +
      // 3. The Job Card's SO line → live SO (the line itself unfiltered, as PR_ORDER_CODE).
      ` (SELECT ${soVal('k_jso')} FROM public.jc_ops k_jo2` +
      ` JOIN public.job_cards k_jc2 ON k_jc2.id = k_jo2.job_card_id AND k_jc2.deleted_at IS NULL` +
      ` JOIN public.sales_order_lines k_jsol ON k_jsol.id = k_jc2.source_so_line_id` +
      ` JOIN public.sales_orders k_jso ON k_jso.id = k_jsol.sales_order_id AND k_jso.deleted_at IS NULL` +
      ` WHERE k_jo2.id = ${pr}.source_jc_op_id AND k_jo2.deleted_at IS NULL)` +
      last +
      `)`,
  );
}

/** 'so:<sales_orders.id>' | 'jw:<job_work_orders.id>' | 'none' — never null. */
export function prOrderKeySql(prAlias: string): SQL {
  return orderOf(prAlias, (so) => `'so:' || ${so}.id::text`, `'jw:' || k_jw.id::text`, `, 'none'`);
}

/** The order No. behind the key (PR_ORDER_CODE-equivalent); null = no order. */
export function prOrderCodeSql(prAlias: string): SQL {
  return orderOf(prAlias, (so) => `${so}.code`, `k_jw.code`, ``);
}
