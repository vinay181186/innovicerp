// Derived progress of a route-card-driven plan (ADR-170).
//
// A plan with `ops_source = 'route_card'` stores no progress of its own: where
// it stands is read off the facts around it — does its item have an active
// Route Card, and does it have a live Production Order, and is that order
// open or closed. Old plans (`ops_source = 'plan'`) keep their stored
// plan_status label and get null here.
//
// Two consumers must agree on the answer — the Plans list (which also filters
// on it in SQL, see plans/service.ts DERIVED_STATUS_SQL) and the SO Planning
// right pane (so-planning/service.ts). Both call this so the rule lives once.
//
// Order of the checks matters and is deliberate: a plan that already has a live
// Production Order is "in production" even if someone has since deleted the
// item's Route Card — the Job Card was built from it and the work is real. The
// route-card check therefore only applies to plans that have no live order yet.
//
// ADR-182 widened this: a plan may now be covered by SEVERAL orders, an order
// may be short closed (which returns its qty to the plan), and the plan is not
// complete while any of its qty is still un-ordered. See derivePlanStatus.

import type { PlanDerivedStatus } from '@innovic/shared';

export interface PlanDerivedStatusInput {
  opsSource: string;
  planStatus: string;
  /** True when the plan's item has an active (not deleted) route card. */
  hasRouteCard: boolean;
  /** ADR-182 — how many LIVE, non-short-closed Production Orders the plan has.
   *  A short-closed order does not count: stopping it gives its qty back and
   *  the plan is orderable again. */
  activeOrderCount: number;
  /** ADR-182 — of those, how many are still 'open' or 'partially_closed'. */
  openOrderCount: number;
  /** ADR-182 — `Pending` (NAMING.md): plan qty − SUM(order qty) of the active
   *  orders, floored at 0. More than 0 means another order can still be
   *  raised for this plan. */
  pendingQty: number;
}

/**
 * ADR-182 changed this rule. A plan is no longer "the plan and its one order";
 * it is a plan and however many orders cover it, so the answer is read off
 * three counts instead of one order's status:
 *
 *   1. no active order at all        → route card missing? 'route_card_pending'
 *                                      else 'gen_production_order'. A plan
 *                                      whose only orders were short closed
 *                                      lands here again, which is right: its
 *                                      qty came back and it needs a new order.
 *   2. Pending > 0                   → 'in_production'. NEVER
 *                                      'production_complete' while pieces are
 *                                      still un-ordered, however finished the
 *                                      orders raised so far are — the plan is
 *                                      not done until every piece is covered.
 *   3. an order still open / partly closed → 'in_production'.
 *   4. otherwise                     → 'production_complete': fully covered and
 *                                      every order closed.
 *
 * Pre-ADR-182 rows are unaffected: their single order took the whole plan qty,
 * so Pending is 0 and the rule reduces to the old open/closed answer. The one
 * deliberate change for old rows is 'partially_closed', which the old rule did
 * not name at all and which fell through to 'gen_production_order'; it now
 * reads 'in_production', which is what it always meant.
 *
 * The SQL twin of this function is DERIVED_STATUS_SQL in plans/service.ts (the
 * list must FILTER on the answer, which it cannot do in TypeScript). The two
 * MUST be changed together.
 */
export function derivePlanStatus(input: PlanDerivedStatusInput): PlanDerivedStatus | null {
  if (input.opsSource !== 'route_card') return null;
  if (input.planStatus === 'cancelled') return null;
  if (input.activeOrderCount <= 0) {
    return input.hasRouteCard ? 'gen_production_order' : 'route_card_pending';
  }
  if (input.pendingQty > 0) return 'in_production';
  if (input.openOrderCount > 0) return 'in_production';
  return 'production_complete';
}
