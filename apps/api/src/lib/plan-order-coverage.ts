// How much of a plan its Production Orders cover (ADR-182) — as SQL, so every
// reader computes it the same way and the Plans list can FILTER on it.
//
// Before ADR-182 a plan had at most ONE live Production Order, enforced by a
// partial unique index, and every reader simply LEFT JOINed production_orders
// on plan_id. That index is gone: a plan of 50 may be covered by 20 + 20 with
// 10 still Pending. A plain LEFT JOIN would now return one copy of the plan row
// per order — duplicated rows, an inflated total, and paging that skips plans.
//
// So nothing joins production_orders to plans any more. The facts below are
// correlated scalar sub-selects: one row per plan, always.
//
// ADR-184 — what ONE order contributes to Covered (the ERPNext rule: plan
// pending = qty − (order qty − process loss)). An order still being made
// ('open' / 'partially_closed') covers its full Order Qty. An order that has
// STOPPED — finished with losses ('closed') or abandoned ('short_closed') —
// covers only what it actually credited to stock; everything it did not
// deliver (lost pieces AND never-made pieces) goes back to the plan's
// `Pending` (NAMING.md: the leftover is `Pending`, never "Remaining" or
// "Balance"). Before ADR-184 a short-closed order was skipped entirely, so
// its credited pieces were ordered a second time (TEST: IN-PRO-00019 credited
// 15 of 20, short closed, plan PLN-0013 went back to Pending 20, not 5).
// Soft-deleted orders are still skipped.
//
// The TypeScript twin of the derived status is lib/plan-derived-status.ts
// (derivePlanStatus). The two MUST be changed together — see the comment there.

import { sql, type SQL } from 'drizzle-orm';
import { plans } from '../db/schema';
import type { DbTransaction } from '../db/with-user-context';

/** ADR-184 — the qty ONE Production Order (aliased `po`) contributes to its
 *  plan's Covered. The single definition: every Covered reader below, the
 *  create cap (production-orders/service.ts, via readPlanOrderCoverage) and
 *  migration 0145 use exactly this expression. */
export const ORDER_COVERED_QTY_SQL = sql.raw(
  `CASE WHEN po.status IN ('closed', 'short_closed') THEN COALESCE(po.credited_qty, 0) ELSE po.order_qty END`,
);

/** `Covered` — SUM over the plan's live orders of ORDER_COVERED_QTY_SQL
 *  (ADR-184): full Order Qty while being made, credited qty once stopped. */
export const PLAN_COVERED_QTY_SQL = sql<number>`COALESCE((
  SELECT SUM(${ORDER_COVERED_QTY_SQL}) FROM public.production_orders po
  WHERE po.plan_id = ${plans.id}
    AND po.deleted_at IS NULL
), 0)::int`;

/** `Pending` — Plan Qty − Covered, floored at 0. What a new order may still be
 *  raised for; the Create screen defaults Order Qty to it and caps it there. */
export const PLAN_PENDING_QTY_SQL = sql<number>`GREATEST(
  ${plans.planQty} - ${PLAN_COVERED_QTY_SQL}, 0)::int`;

/** How many live, non-short-closed orders the plan has. Informational since
 *  ADR-184: planDerivedStatusSql no longer branches on it (Pending and the
 *  open-order count decide), so a plan whose orders are all stopped reads off
 *  its Pending like any other. */
export const PLAN_ACTIVE_ORDER_COUNT_SQL = sql<number>`(
  SELECT COUNT(*) FROM public.production_orders po
  WHERE po.plan_id = ${plans.id}
    AND po.deleted_at IS NULL
    AND po.status <> 'short_closed'
)::int`;

/** Of those, how many are still being worked — 'open' or 'partially_closed'. */
export const PLAN_OPEN_ORDER_COUNT_SQL = sql<number>`(
  SELECT COUNT(*) FROM public.production_orders po
  WHERE po.plan_id = ${plans.id}
    AND po.deleted_at IS NULL
    AND po.status IN ('open', 'partially_closed')
)::int`;

/** One representative order for the plan — the NEWEST live one, whatever its
 *  status. The list still shows a single Production Order No / Status per plan;
 *  with several orders the newest is the one the user just raised and the one
 *  the row's link should open. `column` is a production_orders column name. */
function latestOrderField<T>(column: string): SQL<T> {
  return sql<T>`(
  SELECT po.${sql.raw(column)} FROM public.production_orders po
  WHERE po.plan_id = ${plans.id}
    AND po.deleted_at IS NULL
  ORDER BY po.created_at DESC, po.code DESC
  LIMIT 1
)`;
}

export const PLAN_LATEST_ORDER_ID_SQL = latestOrderField<string | null>('id');
export const PLAN_LATEST_ORDER_CODE_SQL = latestOrderField<string | null>('code');
export const PLAN_LATEST_ORDER_STATUS_SQL = latestOrderField<string | null>('status');

/**
 * The SQL twin of `derivePlanStatus` (lib/plan-derived-status.ts). Same
 * branches, same order (ADR-184); `hasRouteCardSql` is passed in because each
 * module already has its own copy of that EXISTS.
 */
export function planDerivedStatusSql(hasRouteCardSql: SQL<boolean>): SQL<string | null> {
  return sql<string | null>`CASE
  WHEN ${plans.opsSource} <> 'route_card' THEN NULL
  WHEN ${plans.planStatus} = 'cancelled' THEN NULL
  WHEN ${PLAN_OPEN_ORDER_COUNT_SQL} > 0 THEN 'in_production'
  WHEN ${PLAN_PENDING_QTY_SQL} > 0
    THEN CASE WHEN ${hasRouteCardSql} THEN 'gen_production_order' ELSE 'route_card_pending' END
  ELSE 'production_complete'
END`;
}

/**
 * The same Covered figure read as a one-off inside the caller's transaction,
 * together with the codes of the orders that make it up. The readers above are
 * correlated sub-selects for list queries; this is for the WRITE paths, which
 * need the number for ONE plan and must read it inside that plan's
 * `SELECT … FOR UPDATE` so a concurrent create cannot slip past:
 *
 *   - create / close / short close (production-orders/service.ts) — the qty
 *     cap, and does a stop give qty back?
 *   - plan edit / plan delete (plans/service.ts) — is there live work to protect?
 *
 * Same per-order rule as above (ORDER_COVERED_QTY_SQL, ADR-184); soft-deleted
 * orders are skipped. `orderCodes` lists the orders that contribute > 0.
 */
export async function readPlanOrderCoverage(
  tx: DbTransaction,
  planId: string,
): Promise<{ coveredQty: number; orderCodes: string[] }> {
  const rows = (await tx.execute(sql`
    SELECT COALESCE(SUM(${ORDER_COVERED_QTY_SQL}), 0)::int AS covered,
           COALESCE(
             ARRAY_AGG(po.code ORDER BY po.code)
               FILTER (WHERE po.code IS NOT NULL AND ${ORDER_COVERED_QTY_SQL} > 0),
             '{}'
           ) AS codes
    FROM public.production_orders po
    WHERE po.plan_id = ${planId}::uuid
      AND po.deleted_at IS NULL
  `)) as unknown as Array<{ covered: number; codes: string[] | null }>;
  const r = rows[0];
  return {
    coveredQty: Number(r?.covered ?? 0),
    orderCodes: r?.codes ?? [],
  };
}
