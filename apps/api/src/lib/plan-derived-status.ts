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
//
// ADR-184 re-ordered the checks: a stopped order (closed with losses, or
// short closed) now covers only what it credited, so the lost / never-made
// pieces come back as Pending. The answer is read off "is anything still being
// made?" first, then "is anything still Pending?".

import type { PlanDerivedStatus } from '@innovic/shared';

export interface PlanDerivedStatusInput {
  opsSource: string;
  planStatus: string;
  /** True when the plan's item has an active (not deleted) route card. */
  hasRouteCard: boolean;
  /** ADR-182 — how many LIVE, non-short-closed Production Orders the plan has.
   *  Kept for callers; since ADR-184 the status no longer branches on it. */
  activeOrderCount: number;
  /** ADR-182 — of those, how many are still 'open' or 'partially_closed'. */
  openOrderCount: number;
  /** ADR-182 / ADR-184 — `Pending` (NAMING.md): plan qty − Covered, floored at
   *  0, where an open order covers its Order Qty and a closed / short-closed
   *  one covers what it credited (lib/plan-order-coverage.ts). More than 0
   *  means another order can still be raised for this plan. */
  pendingQty: number;
}

/**
 * ADR-184 rule (replaces the ADR-182 order of checks). A plan is read off two
 * facts — is any of its orders still being made, and is any of its qty still
 * Pending:
 *
 *   1. an order still open / partly closed → 'in_production'. Checked first so
 *                                      a plan with live work is in production
 *                                      even if the Route Card has since gone.
 *   2. Pending > 0 (nothing being made) → route card missing?
 *                                      'route_card_pending' else
 *                                      'gen_production_order'. This covers a
 *                                      plan with no order yet AND a plan whose
 *                                      orders all stopped short: an order that
 *                                      finished with losses or was short closed
 *                                      gives back what it did not credit, and
 *                                      that qty needs a new order.
 *   3. otherwise                     → 'production_complete': nothing being
 *                                      made and nothing Pending — every piece
 *                                      is credited, whether its orders read
 *                                      'closed' or 'short_closed'.
 *
 * The SQL twin of this function is planDerivedStatusSql in
 * lib/plan-order-coverage.ts (the list must FILTER on the answer, which it
 * cannot do in TypeScript). The two MUST be changed together.
 */
export function derivePlanStatus(input: PlanDerivedStatusInput): PlanDerivedStatus | null {
  if (input.opsSource !== 'route_card') return null;
  if (input.planStatus === 'cancelled') return null;
  if (input.openOrderCount > 0) return 'in_production';
  if (input.pendingQty > 0) {
    return input.hasRouteCard ? 'gen_production_order' : 'route_card_pending';
  }
  return 'production_complete';
}
