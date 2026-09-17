// Where a plan's operations come from. Column `plans.ops_source` (migration 0133).
//
//   plan       — the OLD flow: operations were typed into the plan itself
//                (`plan_ops`) and "Execute" copied them onto the Job Card.
//   route_card — the NEW flow (Production Orders): the plan holds only
//                qty / dates / raw material / remark. Operations come from the
//                item's Route Card at the moment a Production Order is created.
//                Such a plan has no ops editor and no Execute button; the
//                server refuses `POST /plans/:id/execute` for it.
//
// Stored explicitly (not inferred from "0 ops") so an old planned plan with no
// ops (direct purchase / full outsource) is never mistaken for a new-flow plan.
export const PLAN_OPS_SOURCES = ['plan', 'route_card'] as const;
export type PlanOpsSource = (typeof PLAN_OPS_SOURCES)[number];
