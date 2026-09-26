export const PLAN_STATUSES = [
  'in_planning',
  'planned',
  'jc_created',
  'pr_created',
  'in_production',
  'complete',
  'cancelled',
] as const;

export type PlanStatus = (typeof PLAN_STATUSES)[number];

/** ADR-185 — the status a plan's ROW shows, which is what the Plans list
 *  filters and its KPI tiles count by. An old plan (ops_source 'plan') shows
 *  its stored status. A route-card plan shows its derived status, spelled in
 *  the stored words where one exists (production_complete → 'complete',
 *  in_production → 'in_production') plus the two that have no stored twin.
 *  One vocabulary, so a tile, the filter and the row can never disagree. */
export const PLAN_EFFECTIVE_STATUSES = [
  ...PLAN_STATUSES,
  'route_card_pending',
  'gen_production_order',
] as const;

export type PlanEffectiveStatus = (typeof PLAN_EFFECTIVE_STATUSES)[number];
