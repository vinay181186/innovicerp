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
// Order of the checks matters and is deliberate: a plan whose Production Order
// already exists is "in production" even if someone has since deleted the
// item's Route Card — the Job Card was built from it and the work is real. The
// route-card check therefore only applies to plans that have no order yet.

import type { PlanDerivedStatus } from '@innovic/shared';

export interface PlanDerivedStatusInput {
  opsSource: string;
  planStatus: string;
  /** True when the plan's item has an active (not deleted) route card. */
  hasRouteCard: boolean;
  /** Status of the plan's live Production Order ('open' | 'closed'), null when none. */
  poStatus: string | null;
}

export function derivePlanStatus(input: PlanDerivedStatusInput): PlanDerivedStatus | null {
  if (input.opsSource !== 'route_card') return null;
  if (input.planStatus === 'cancelled') return null;
  if (input.poStatus === 'closed') return 'production_complete';
  if (input.poStatus === 'open') return 'in_production';
  if (!input.hasRouteCard) return 'route_card_pending';
  return 'gen_production_order';
}
