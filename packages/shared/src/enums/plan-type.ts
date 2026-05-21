export const PLAN_TYPES = [
  'manufacture',
  'direct_purchase',
  'full_outsource',
  'assembly',
] as const;

export type PlanType = (typeof PLAN_TYPES)[number];
