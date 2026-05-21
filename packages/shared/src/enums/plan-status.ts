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
