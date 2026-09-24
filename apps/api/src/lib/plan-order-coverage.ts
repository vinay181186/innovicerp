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
// Covered / Pending both SKIP short-closed orders on purpose. Stopping an order
// returns its un-produced qty to the plan, so the plan becomes orderable again
// for exactly that qty (NAMING.md: the leftover is `Pending`, never "Remaining"
// or "Balance").
//
// The TypeScript twin of the derived status is lib/plan-derived-status.ts
// (derivePlanStatus). The two MUST be changed together — see the comment there.

import { sql, type SQL } from 'drizzle-orm';
import { plans } from '../db/schema';
import type { DbTransaction } from '../db/with-user-context';

/** `Covered` — SUM(Order Qty) of the plan's live, non-short-closed orders. */
export const PLAN_COVERED_QTY_SQL = sql<number>`COALESCE((
  SELECT SUM(po.order_qty) FROM public.production_orders po
  WHERE po.plan_id = ${plans.id}
    AND po.deleted_at IS NULL
    AND po.status <> 'short_closed'
), 0)::int`;

/** `Pending` — Plan Qty − Covered, floored at 0. What a new order may still be
 *  raised for; the Create screen defaults Order Qty to it and caps it there. */
export const PLAN_PENDING_QTY_SQL = sql<number>`GREATEST(
  ${plans.planQty} - ${PLAN_COVERED_QTY_SQL}, 0)::int`;

/** How many live, non-short-closed orders the plan has. Zero means the plan is
 *  back to "raise an order" — including a plan whose only orders were stopped. */
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
 * The SQL twin of `derivePlanStatus` (lib/plan-derived-status.ts). Same four
 * branches, same order; `hasRouteCardSql` is passed in because each module
 * already has its own copy of that EXISTS.
 */
export function planDerivedStatusSql(hasRouteCardSql: SQL<boolean>): SQL<string | null> {
  return sql<string | null>`CASE
  WHEN ${plans.opsSource} <> 'route_card' THEN NULL
  WHEN ${plans.planStatus} = 'cancelled' THEN NULL
  WHEN ${PLAN_ACTIVE_ORDER_COUNT_SQL} <= 0
    THEN CASE WHEN ${hasRouteCardSql} THEN 'gen_production_order' ELSE 'route_card_pending' END
  WHEN ${PLAN_PENDING_QTY_SQL} > 0 THEN 'in_production'
  WHEN ${PLAN_OPEN_ORDER_COUNT_SQL} > 0 THEN 'in_production'
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
 *   - short close (production-orders/service.ts) — does the stop give qty back?
 *   - plan edit / plan delete (plans/service.ts) — is there live work to protect?
 *
 * Short-closed and soft-deleted orders are skipped, exactly as above.
 */
export async function readPlanOrderCoverage(
  tx: DbTransaction,
  planId: string,
): Promise<{ coveredQty: number; orderCodes: string[] }> {
  const rows = (await tx.execute(sql`
    SELECT COALESCE(SUM(po.order_qty), 0)::int AS covered,
           COALESCE(
             ARRAY_AGG(po.code ORDER BY po.code) FILTER (WHERE po.code IS NOT NULL),
             '{}'
           ) AS codes
    FROM public.production_orders po
    WHERE po.plan_id = ${planId}::uuid
      AND po.deleted_at IS NULL
      AND po.status <> 'short_closed'
  `)) as unknown as Array<{ covered: number; codes: string[] | null }>;
  const r = rows[0];
  return {
    coveredQty: Number(r?.covered ?? 0),
    orderCodes: r?.codes ?? [],
  };
}
