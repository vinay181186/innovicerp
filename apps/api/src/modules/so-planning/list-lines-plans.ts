// The plans of the Planning list's lines (ADR-268): one query for SO and JWSO lines
// together, named columns only. The order view's loadPlanSummariesByLine also works
// out derived status, pending qty, ops counts and OSP PRs per plan; the list shows
// none of them, and it runs for EVERY open line on every page.

import type { PlanningLineListPlan } from '@innovic/shared';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import { jobCards, plans, routeCards } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import { loadProductionOrdersByPlan, PLAN_RC_JOIN_ON } from './plan-summaries';

export interface ListPlansOfLines {
  plansByLine: Map<string, PlanningLineListPlan[]>;
  /** bom_master_id per plan — the part-plan test (ADR-107 / ADR-221) needs it. */
  bomMasterByPlan: Map<string, string | null>;
}

export async function loadListPlansByLine(
  tx: DbTransaction,
  soLineIds: string[],
  jwLineIds: string[],
): Promise<ListPlansOfLines> {
  const plansByLine = new Map<string, PlanningLineListPlan[]>();
  const bomMasterByPlan = new Map<string, string | null>();
  if (soLineIds.length === 0 && jwLineIds.length === 0) return { plansByLine, bomMasterByPlan };
  const rows = await tx
    .select({
      id: plans.id,
      code: plans.code,
      soLineId: plans.soLineId,
      jwLineId: plans.jwLineId,
      planStatus: plans.planStatus,
      planQty: plans.planQty,
      bomMasterId: plans.bomMasterId,
      bomChildCode: plans.bomChildCode,
      jcId: plans.jcId,
      jcCode: jobCards.code,
      routeCardCode: sql<string | null>`plan_rc.code`.as('plan_rc_code'),
      routeCardApprovalStatus: sql<
        PlanningLineListPlan['routeCardApprovalStatus']
      >`plan_rc.approval_status`.as('plan_rc_approval_status'),
    })
    .from(plans)
    .leftJoin(jobCards, and(eq(jobCards.id, plans.jcId), isNull(jobCards.deletedAt)))
    .leftJoin(sql`${routeCards} as plan_rc`, PLAN_RC_JOIN_ON)
    .where(
      and(
        or(
          soLineIds.length > 0 ? inArray(plans.soLineId, soLineIds) : undefined,
          jwLineIds.length > 0 ? inArray(plans.jwLineId, jwLineIds) : undefined,
        ),
        isNull(plans.deletedAt),
        sql`${plans.planStatus} <> 'cancelled'`,
      ),
    )
    .orderBy(asc(plans.code));
  const posByPlan = await loadProductionOrdersByPlan(
    tx,
    rows.map((r) => r.id),
  );
  for (const r of rows) {
    bomMasterByPlan.set(r.id, r.bomMasterId);
    const lineId = r.soLineId ?? r.jwLineId;
    if (!lineId) continue;
    const bucket = plansByLine.get(lineId) ?? [];
    bucket.push({
      id: r.id,
      code: r.code,
      planStatus: r.planStatus,
      planQty: r.planQty,
      bomChildCode: r.bomChildCode,
      routeCardCode: r.routeCardCode ?? null,
      routeCardApprovalStatus: r.routeCardApprovalStatus ?? null,
      productionOrders: posByPlan.get(r.id) ?? [],
      // The list always sends the full list above, so the older-build fallback
      // these two feed in planPros never applies.
      productionOrderId: null,
      productionOrderCode: null,
      jcId: r.jcId ?? null,
      jcCode: r.jcCode ?? null,
    });
    plansByLine.set(lineId, bucket);
  }
  return { plansByLine, bomMasterByPlan };
}
