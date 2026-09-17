// Derived (never stored) progress of a route-card-driven plan
// (`plans.ops_source = 'route_card'`), read by Production → Plans and the
// Production Order pickers. Computed server-side in `listPlans`:
//
//   route_card_pending   — the item has no active Route Card yet, so no
//                          Production Order can be raised ("no route card, no
//                          way forward").
//   gen_production_order — Route Card exists, no Production Order yet.
//   in_production        — Production Order is open (Job Card in progress or
//                          complete but not yet closed).
//   production_complete  — Production Order closed; stock credited.
//
// Old plans (`ops_source = 'plan'`) carry null here and keep their stored
// `plan_status` label unchanged.
export const PLAN_DERIVED_STATUSES = [
  'route_card_pending',
  'gen_production_order',
  'in_production',
  'production_complete',
] as const;
export type PlanDerivedStatus = (typeof PLAN_DERIVED_STATUSES)[number];

export const PLAN_DERIVED_STATUS_LABEL: Record<PlanDerivedStatus, string> = {
  route_card_pending: 'Route card pending',
  gen_production_order: 'Gen production order',
  in_production: 'In production',
  production_complete: 'Production complete',
};
