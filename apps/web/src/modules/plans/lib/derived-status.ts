import type { PlanDerivedStatus } from '@innovic/shared';

// ADR-170 / ADR-185 — the derived status of a route-card-driven plan, in the
// planner's own words (user, 2026-09-19: "RC" is the route card). ONE map for
// the Plans list and the plan detail, so the two screens can never name the
// same plan's state differently.
export const DERIVED_LABEL: Record<PlanDerivedStatus, string> = {
  route_card_pending: 'RC Pending',
  gen_production_order: 'RC Created',
  in_production: 'In Production',
  production_complete: 'Completed',
};

// One colour per state (ADR-186): grey = no route card yet, blue = ready for a
// Production Order, amber = order open, green = done.
export const DERIVED_BADGE: Record<PlanDerivedStatus, string> = {
  route_card_pending: 'b-grey',
  gen_production_order: 'b-blue',
  // Same colour as the stored 'in_production' badge (list STATUS_BADGE): one
  // status, one colour, whichever kind of plan the row is.
  in_production: 'b-amber',
  production_complete: 'b-green',
};
