// SO Planning (ADR-268) — the plans of a batch of SO / JWSO lines as
// PlanningPlanSummary, in ONE place, for the order detail (service.ts). The Planning
// list reads a leaner set of columns (list-lines-plans.ts) through the same rules
// below: LIVE_PLAN, PLAN_RC_JOIN_ON, loadProductionOrdersByPlan. list-lines.test.ts
// holds the two together. A fixed number of queries whatever the number of lines. The helpers below were
// moved here unchanged from service.ts.

import type { PlanningPlanSummary } from '@innovic/shared';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  items,
  jcOps,
  jobCards,
  planOps,
  plans,
  productionOrders,
  purchaseRequests,
  routeCards,
} from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import { derivePlanStatus } from '../../lib/plan-derived-status';
import {
  PLAN_ACTIVE_ORDER_COUNT_SQL,
  PLAN_HAS_ROUTE_CARD_SQL,
  PLAN_HAS_USABLE_ROUTE_CARD_SQL,
  PLAN_LATEST_ORDER_CODE_SQL,
  PLAN_LATEST_ORDER_ID_SQL,
  PLAN_LATEST_ORDER_STATUS_SQL,
  PLAN_OPEN_ORDER_COUNT_SQL,
  PLAN_PENDING_QTY_SQL,
} from '../../lib/plan-order-coverage';
import { displayRouteCardIdSql } from '../../lib/route-card-for-rev';
import type { LineSource } from './line-facts';

// ADR-170 — a route-card plan's derived status hangs on two live facts read
// alongside the plan: its Production Orders and whether its item has an active
// Route Card. Same rule as plans/service.ts listPlans via
// lib/plan-derived-status.
//
// ADR-182: production_orders is NOT joined. A plan may have several live
// orders now, and a LEFT JOIN on plan_id would return one copy of the plan per
// order — the same plan would appear twice in the SO Planning pane. Every order
// fact is a correlated scalar (lib/plan-order-coverage.ts) instead.
//
// ADR-253 — "has a live card" and "that card is approved" come from the ONE
// shared fragment in lib/plan-order-coverage.ts, same as the Plans list.
export const HAS_ROUTE_CARD_SQL = PLAN_HAS_ROUTE_CARD_SQL;
export const ROUTE_CARD_USABLE_SQL = PLAN_HAS_USABLE_ROUTE_CARD_SQL;
/** The ADR-170 fields every plan summary carries, from one row. */
export function routeCardPlanFields(r: {
  plan: typeof plans.$inferSelect;
  poId: string | null;
  poCode: string | null;
  poStatus: string | null;
  hasRouteCard: boolean | null;
  routeCardUsable: boolean | null;
  routeCardCode: string | null;
  routeCardApprovalStatus: string | null;
  activeOrderCount: number | null;
  openOrderCount: number | null;
  pendingQty: number | null;
}): Pick<
  PlanningPlanSummary,
  | 'opsSource'
  | 'derivedStatus'
  | 'productionOrderId'
  | 'productionOrderCode'
  | 'routeCardCode'
  | 'routeCardApprovalStatus'
  | 'plannedStartDate'
  | 'plannedEndDate'
  | 'rawMaterialGradeText'
  | 'rawMaterialSizeText'
  | 'remarks'
> {
  return {
    opsSource: r.plan.opsSource === 'route_card' ? 'route_card' : 'plan',
    derivedStatus: derivePlanStatus({
      opsSource: r.plan.opsSource,
      planStatus: r.plan.planStatus,
      hasRouteCard: Boolean(r.hasRouteCard),
      routeCardUsable: Boolean(r.routeCardUsable),
      activeOrderCount: Number(r.activeOrderCount ?? 0),
      openOrderCount: Number(r.openOrderCount ?? 0),
      pendingQty: Number(r.pendingQty ?? 0),
    }),
    productionOrderId: r.poId ?? null,
    productionOrderCode: r.poCode ?? null,
    routeCardCode: r.routeCardCode ?? null,
    routeCardApprovalStatus: toRouteCardApprovalStatus(r.routeCardApprovalStatus),
    plannedStartDate: r.plan.plannedStartDate ?? null,
    plannedEndDate: r.plan.plannedEndDate ?? null,
    rawMaterialGradeText: r.plan.rawMaterialGradeText ?? null,
    rawMaterialSizeText: r.plan.rawMaterialSizeText ?? null,
    remarks: r.plan.remarks ?? null,
  };
}

/** The contract's three approval states; anything else (no card) is null. */
export function toRouteCardApprovalStatus(
  raw: string | null | undefined,
): PlanningPlanSummary['routeCardApprovalStatus'] {
  return raw === 'pending' || raw === 'approved' || raw === 'rejected' ? raw : null;
}

// ADR-216 — WHICH item a plan is for. A plan raised from the BOM modal sits on
// the parent's SO line but is for a CHILD part (ADR-030 grain: one plan per SO
// line x BOM child), so the line's own item is the wrong answer and the plan
// chip used to show nothing at all. Live code/name come from a plan-item join
// aliased `plan_item` — the bare `items` name is already taken in this file by
// the SO LINE's item, and reusing it would make every chip read the parent
// ("WASHER DRG") instead of the child ("WHEEL"). Snapshot columns are the
// fallback, read as `itemCode ?? itemCodeText` (the Plans list's own pattern).
export function planItemFields(r: {
  plan: typeof plans.$inferSelect;
  planItemCode: string | null;
  planItemName: string | null;
}): Pick<
  PlanningPlanSummary,
  'itemId' | 'itemCode' | 'itemCodeText' | 'itemName' | 'itemNameText' | 'bomChildCode'
> {
  return {
    itemId: r.plan.itemId ?? null,
    itemCode: r.planItemCode ?? null,
    itemCodeText: r.plan.itemCodeText ?? null,
    itemName: r.planItemName ?? null,
    itemNameText: r.plan.itemNameText ?? null,
    bomChildCode: r.plan.bomChildCode ?? null,
  };
}

/** A plan that counts: not in Trash, not cancelled. */
export const LIVE_PLAN = and(isNull(plans.deletedAt), sql`${plans.planStatus} <> 'cancelled'`);

/** The `plan_item` join behind {@link planItemFields}. LEFT, never inner: an
 *  ad-hoc plan has no item_id and a plan whose item was deleted must still
 *  appear on the line. `deleted_at is null` so a soft-deleted item cannot
 *  resurrect its name here. */
export const PLAN_ITEM_JOIN_ON = sql`plan_item.id = ${plans.itemId} and plan_item.deleted_at is null`;

/** The `plan_rc` join: the plan's live Route Card (code + ADR-253 approval
 *  state for the Planning "RC No." column). One LEFT JOIN instead of a
 *  correlated sub-select per field per plan. Drawing Rev register (0232): an
 *  item may now have one card per Rev, so the card is PICKED, never joined on
 *  item — the card for the plan's own Item + Rev, else the item's old no-Rev
 *  card (shown so the planner can find the card that still needs a Rev; the
 *  plan's status stays STRICT via PLAN_ROUTE_CARD_USABLE_SQL). At most one
 *  row, so plan rows are never multiplied. No card → plan_rc.* null → "Pending". */
export const PLAN_RC_JOIN_ON = sql`plan_rc.id = ${displayRouteCardIdSql(sql`${plans.itemId}`, sql`${plans.itemRevisionId}`)}`;

/**
 * OSP purchase requests auto-raised for each plan's outsource ops, keyed by
 * plan id. Walks plan.jc_id → jc_ops.outsource_pr_id → purchase_requests, so a
 * manufacture plan's card can link straight to the PR(s). Returns [] for plans
 * with no JC or no outsourced ops.
 */
async function loadOspPrsByPlan(
  tx: DbTransaction,
  planRows: readonly { id: string; jcId: string | null }[],
): Promise<Map<string, { id: string; code: string }[]>> {
  const map = new Map<string, { id: string; code: string }[]>();
  const jcToPlan = new Map<string, string>();
  for (const p of planRows) if (p.jcId) jcToPlan.set(p.jcId, p.id);
  const jcIds = [...jcToPlan.keys()];
  if (jcIds.length === 0) return map;

  const rows = await tx
    .select({
      jobCardId: jcOps.jobCardId,
      prId: purchaseRequests.id,
      prCode: purchaseRequests.code,
      opSeq: jcOps.opSeq,
    })
    .from(jcOps)
    .innerJoin(
      purchaseRequests,
      and(eq(purchaseRequests.id, jcOps.outsourcePrId), isNull(purchaseRequests.deletedAt)),
    )
    .where(and(inArray(jcOps.jobCardId, jcIds), isNull(jcOps.deletedAt)))
    .orderBy(asc(jcOps.opSeq));

  for (const r of rows) {
    const planId = jcToPlan.get(r.jobCardId);
    if (!planId) continue;
    const arr = map.get(planId) ?? [];
    arr.push({ id: r.prId, code: r.prCode });
    map.set(planId, arr);
  }
  return map;
}

type PlanOrderRef = PlanningPlanSummary['productionOrders'][number];

/**
 * EVERY live Production Order of each plan, oldest first, with the Job Card
 * it built — keyed by plan id. One batched query, never a join on the plan
 * query (ADR-182: that would return one copy of the plan per order). A Job
 * Card in Trash comes back as jobCardId / jcCode null.
 */
export async function loadProductionOrdersByPlan(
  tx: DbTransaction,
  planIds: readonly string[],
): Promise<Map<string, PlanOrderRef[]>> {
  const map = new Map<string, PlanOrderRef[]>();
  if (planIds.length === 0) return map;
  const rows = await tx
    .select({
      planId: productionOrders.planId,
      id: productionOrders.id,
      code: productionOrders.code,
      status: productionOrders.status,
      jobCardId: jobCards.id,
      jcCode: jobCards.code,
    })
    .from(productionOrders)
    .leftJoin(
      jobCards,
      and(eq(jobCards.id, productionOrders.jobCardId), isNull(jobCards.deletedAt)),
    )
    .where(
      and(
        inArray(productionOrders.planId, [...planIds]),
        isNull(productionOrders.deletedAt),
        // ADR-235 — a cancelled order is out (cancel stamps deleted_at too;
        // cancelled_at is checked as well so the rule never hangs on that).
        isNull(productionOrders.cancelledAt),
      ),
    )
    .orderBy(asc(productionOrders.createdAt), asc(productionOrders.code));
  for (const r of rows) {
    const arr = map.get(r.planId) ?? [];
    arr.push({
      id: r.id,
      code: r.code,
      status: r.status,
      jobCardId: r.jobCardId ?? null,
      jcCode: r.jcCode ?? null,
    });
    map.set(r.planId, arr);
  }
  return map;
}

/**
 * Every live, non-cancelled plan of these lines: `plansByLine` holds the
 * summaries (plan code order), `planRows` the raw rows for what a caller needs
 * beyond the summary (bom_master_id, the JC link). `source` says which link the
 * line ids are: 'so' = plans.so_line_id, 'jw' = plans.jw_line_id. Four queries.
 */
export async function loadPlanSummariesByLine(
  tx: DbTransaction,
  lineIds: string[],
  source: LineSource,
) {
  const planRows =
    lineIds.length === 0
      ? []
      : await tx
          .select({
            plan: plans,
            jcCode: jobCards.code,
            dpPrCode: sql<string | null>`dp_pr.code`.as('dp_pr_code'),
            foPrCode: sql<string | null>`fo_pr.code`.as('fo_pr_code'),
            foMatPrCode: sql<string | null>`fo_mat_pr.code`.as('fo_mat_pr_code'),
            // ADR-216 — the PLAN's own item (a BOM child on a BOM line), via
            // the aliased `plan_item` join. Never the bare `items` table:
            // that is the SO LINE's item above and would show the parent.
            planItemCode: sql<string | null>`plan_item.code`.as('plan_item_code'),
            planItemName: sql<string | null>`plan_item.name`.as('plan_item_name'),
            poId: PLAN_LATEST_ORDER_ID_SQL,
            poCode: PLAN_LATEST_ORDER_CODE_SQL,
            poStatus: PLAN_LATEST_ORDER_STATUS_SQL,
            activeOrderCount: PLAN_ACTIVE_ORDER_COUNT_SQL,
            openOrderCount: PLAN_OPEN_ORDER_COUNT_SQL,
            pendingQty: PLAN_PENDING_QTY_SQL,
            hasRouteCard: HAS_ROUTE_CARD_SQL,
            routeCardUsable: ROUTE_CARD_USABLE_SQL,
            routeCardCode: sql<string | null>`plan_rc.code`.as('plan_rc_code'),
            routeCardApprovalStatus: sql<string | null>`plan_rc.approval_status`.as(
              'plan_rc_approval_status',
            ),
          })
          .from(plans)
          .leftJoin(jobCards, and(eq(jobCards.id, plans.jcId), isNull(jobCards.deletedAt)))
          .leftJoin(
            sql`${purchaseRequests} as dp_pr`,
            sql`dp_pr.id = ${plans.dpPrId} and dp_pr.deleted_at is null`,
          )
          .leftJoin(
            sql`${purchaseRequests} as fo_pr`,
            sql`fo_pr.id = ${plans.foPrId} and fo_pr.deleted_at is null`,
          )
          .leftJoin(
            sql`${purchaseRequests} as fo_mat_pr`,
            sql`fo_mat_pr.id = ${plans.foMatPrId} and fo_mat_pr.deleted_at is null`,
          )
          .leftJoin(sql`${items} as plan_item`, PLAN_ITEM_JOIN_ON)
          .leftJoin(sql`${routeCards} as plan_rc`, PLAN_RC_JOIN_ON)
          .where(
            and(
              source === 'so' ? inArray(plans.soLineId, lineIds) : inArray(plans.jwLineId, lineIds),
              LIVE_PLAN,
            ),
          )
          .orderBy(asc(plans.code));

  const planIds = planRows.map((r) => r.plan.id);
  const posByPlan = await loadProductionOrdersByPlan(tx, planIds);
  const ospPrsMap = await loadOspPrsByPlan(
    tx,
    planRows.map((r) => ({ id: r.plan.id, jcId: r.plan.jcId ?? null })),
  );

  // 4. Ops counts (and any outsource flag) per plan.
  const opsAgg =
    planIds.length === 0
      ? []
      : await tx
          .select({
            planId: planOps.planId,
            c: count(),
            outsourceCount:
              sql<number>`count(*) filter (where ${planOps.opType} = 'outsource')::int`.as(
                'os_count',
              ),
          })
          .from(planOps)
          .where(and(inArray(planOps.planId, planIds), isNull(planOps.deletedAt)))
          .groupBy(planOps.planId);
  const opsCountMap = new Map<string, { count: number; hasOutsource: boolean }>();
  for (const r of opsAgg) {
    opsCountMap.set(r.planId, {
      count: Number(r.c),
      hasOutsource: Number(r.outsourceCount) > 0,
    });
  }

  const plansByLine = new Map<string, PlanningPlanSummary[]>();
  for (const r of planRows) {
    const lineId = source === 'so' ? r.plan.soLineId : r.plan.jwLineId;
    if (!lineId) continue;
    const ops = opsCountMap.get(r.plan.id) ?? { count: 0, hasOutsource: false };
    const summary: PlanningPlanSummary = {
      id: r.plan.id,
      code: r.plan.code,
      planType: r.plan.planType,
      planStatus: r.plan.planStatus,
      ...routeCardPlanFields(r),
      productionOrders: posByPlan.get(r.plan.id) ?? [],
      ...planItemFields(r),
      planQty: r.plan.planQty,
      opsCount: ops.count,
      hasOutsourceOp: ops.hasOutsource,
      jcId: r.plan.jcId ?? null,
      jcCode: r.jcCode ?? null,
      dpPrId: r.plan.dpPrId ?? null,
      dpPrCode: r.dpPrCode ?? null,
      foPrId: r.plan.foPrId ?? null,
      foPrCode: r.foPrCode ?? null,
      foMatPrId: r.plan.foMatPrId ?? null,
      foMatPrCode: r.foMatPrCode ?? null,
      foVendorCodeText: r.plan.foVendorCodeText,
      ospPrs: ospPrsMap.get(r.plan.id) ?? [],
    };
    const bucket = plansByLine.get(lineId);
    if (bucket) bucket.push(summary);
    else plansByLine.set(lineId, [summary]);
  }
  return { planRows, plansByLine };
}
