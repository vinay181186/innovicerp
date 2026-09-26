// SO Planning workflow service (PL-4b).
//
// Two read endpoints powering the legacy /planning two-pane workflow:
//
//   GET /so-planning              → left pane SO list with planning %
//   GET /so-planning/:soId        → right pane lines + plans + BOM flags
//   GET /so-planning/:soId/bom/:lineId → §8 + §9 BOM explosion + child plans
//
// Math + grouping mirror legacy renderSOPlanning (HTML L9299) +
// showEquipBOMPlanning (L8848) + showBOMPlanning (L7116). Reads only, except
// raisePlanningPr (ADR-171) — plan writes still go through plans/service.ts.
//
// Query plan: batched. List endpoint = 2 round-trips. Detail = 3.
// BOM endpoint = 5.

import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type {
  ItemProcurementType,
  PlanningBomChild,
  PlanningBomResponse,
  PlanningDetailResponse,
  PlanningLine,
  PlanningPlanSummary,
  PlanningSoListResponse,
  RaisePlanningPrInput,
  RaisePlanningPrResponse,
} from '@innovic/shared';
import {
  bomMasterLines,
  bomMasters,
  items,
  itemStockBalances,
  jcOps,
  jobCards,
  jobWorkOrderLines,
  jobWorkOrders,
  planOps,
  plans,
  purchaseOrders,
  purchaseRequests,
  salesOrderLines,
  salesOrders,
} from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { withUniqueRetry } from '../../lib/db-retry';
import { AuthorizationError, NotFoundError, ValidationError } from '../../lib/errors';
import { derivePlanStatus } from '../../lib/plan-derived-status';
import {
  PLAN_ACTIVE_ORDER_COUNT_SQL,
  PLAN_LATEST_ORDER_CODE_SQL,
  PLAN_LATEST_ORDER_ID_SQL,
  PLAN_LATEST_ORDER_STATUS_SQL,
  PLAN_OPEN_ORDER_COUNT_SQL,
  PLAN_PENDING_QTY_SQL,
} from '../../lib/plan-order-coverage';
import { readReservedByLine, readStockPositions } from '../../lib/stock-reservation';
import { prCoverQtyRaw, soLineCoveredRaw, soLinePlannedRaw } from '../../lib/so-line-coverage';
import { emitActivityLog } from '../activity-log/service';
import { nextSeriesCode } from '../op-entry/osp-cascade';

// ADR-170 — a route-card plan's derived status hangs on two live facts read
// alongside the plan: its Production Orders and whether its item has an active
// Route Card. Same rule as plans/service.ts listPlans via
// lib/plan-derived-status.
//
// ADR-182: production_orders is NOT joined. A plan may have several live
// orders now, and a LEFT JOIN on plan_id would return one copy of the plan per
// order — the same plan would appear twice in the SO Planning pane. Every order
// fact is a correlated scalar (lib/plan-order-coverage.ts) instead.
const HAS_ROUTE_CARD_SQL = sql<boolean>`EXISTS (
  SELECT 1 FROM public.route_cards rc
  WHERE rc.company_id = ${plans.companyId}
    AND rc.item_id = ${plans.itemId}
    AND rc.deleted_at IS NULL
)`;
/** The ADR-170 fields every plan summary carries, from one row. */
function routeCardPlanFields(r: {
  plan: typeof plans.$inferSelect;
  poId: string | null;
  poCode: string | null;
  poStatus: string | null;
  hasRouteCard: boolean | null;
  activeOrderCount: number | null;
  openOrderCount: number | null;
  pendingQty: number | null;
}): Pick<
  PlanningPlanSummary,
  | 'opsSource'
  | 'derivedStatus'
  | 'productionOrderId'
  | 'productionOrderCode'
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
      activeOrderCount: Number(r.activeOrderCount ?? 0),
      openOrderCount: Number(r.openOrderCount ?? 0),
      pendingQty: Number(r.pendingQty ?? 0),
    }),
    productionOrderId: r.poId ?? null,
    productionOrderCode: r.poCode ?? null,
    plannedStartDate: r.plan.plannedStartDate ?? null,
    plannedEndDate: r.plan.plannedEndDate ?? null,
    rawMaterialGradeText: r.plan.rawMaterialGradeText ?? null,
    rawMaterialSizeText: r.plan.rawMaterialSizeText ?? null,
    remarks: r.plan.remarks ?? null,
  };
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function classifyPlanningPct(pct: number): 'fully_planned' | 'partial' | 'unplanned' {
  if (pct >= 100) return 'fully_planned';
  if (pct > 0) return 'partial';
  return 'unplanned';
}

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
    .innerJoin(purchaseRequests, eq(purchaseRequests.id, jcOps.outsourcePrId))
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

/** ADR-171 — 'make' unless the Item Master says 'buy'. A free-text line (no
 *  item) is 'make': it can only ever be planned, never bought through + PR. */
function toProcurementType(raw: string | null | undefined): ItemProcurementType {
  return raw === 'buy' ? 'buy' : 'make';
}

/** The filter that makes a purchase request "this SO line's PR" (ADR-171):
 *  a standard PR raised straight against the line — not an OSP PR, which
 *  hangs off a JC op and belongs to a plan's card, not the line. */
function linePrFilter(companyId: string, lineIds: string[]) {
  return and(
    eq(purchaseRequests.companyId, companyId),
    inArray(purchaseRequests.sourceSoLineId, lineIds),
    isNull(purchaseRequests.deletedAt),
    isNull(purchaseRequests.sourceJcOpId),
    eq(purchaseRequests.prType, 'standard'),
    NOT_A_PLAN_PR,
  );
}

/** A PR that an OLD direct-purchase / full-outsource plan raised on Execute
 *  also carries `source_so_line_id` and `pr_type='standard'` — but that qty is
 *  already counted through the plan's `plan_qty`. Counting it again here would
 *  double a Buy line's planned qty the moment its item is flagged Buy (exactly
 *  the migration story). The plan points at its PR through dp_pr_id /
 *  fo_pr_id / fo_mat_pr_id / material_pr_id, so those PRs are not "line PRs". */
const NOT_A_PLAN_PR = sql`NOT EXISTS (
  SELECT 1 FROM ${plans} p
  WHERE p.deleted_at IS NULL
    AND ${purchaseRequests.id} IN (p.dp_pr_id, p.fo_pr_id, p.fo_mat_pr_id, p.material_pr_id)
)`;

type LinePrs = { prs: PlanningLine['prs']; prQty: number };

/**
 * ADR-171 — purchase requests raised from the Planning line, keyed by SO line
 * id. `prQty` is the live total (cancelled PRs excluded); `prs` lists every one
 * including cancelled so the chip row tells the whole story. `poCode` is the
 * purchase order stamped on the PR (`purchase_requests.po_id`, the first PO
 * raised from it), when any.
 */
async function loadPrsByLine(
  tx: DbTransaction,
  companyId: string,
  lineIds: string[],
): Promise<Map<string, LinePrs>> {
  const map = new Map<string, LinePrs>();
  if (lineIds.length === 0) return map;
  const rows = await tx
    .select({
      id: purchaseRequests.id,
      code: purchaseRequests.code,
      qty: purchaseRequests.qty,
      // ADR-189 — what the PR still covers (ordered only, once balance-closed).
      coverQty: sql<number>`${sql.raw(prCoverQtyRaw('purchase_requests'))}::int`,
      status: purchaseRequests.status,
      soLineId: purchaseRequests.sourceSoLineId,
      poCode: purchaseOrders.code,
    })
    .from(purchaseRequests)
    .leftJoin(
      purchaseOrders,
      and(eq(purchaseOrders.id, purchaseRequests.poId), isNull(purchaseOrders.deletedAt)),
    )
    .where(linePrFilter(companyId, lineIds))
    .orderBy(asc(purchaseRequests.code));
  for (const r of rows) {
    if (!r.soLineId) continue;
    const entry = map.get(r.soLineId) ?? { prs: [], prQty: 0 };
    entry.prs.push({
      id: r.id,
      code: r.code,
      qty: Number(r.qty),
      status: r.status,
      poCode: r.poCode ?? null,
    });
    if (r.status !== 'cancelled') entry.prQty += Number(r.coverQty);
    map.set(r.soLineId, entry);
  }
  return map;
}

// ─── Left pane ───────────────────────────────────────────────────────────

export async function getPlanningSoList(user: AuthContext): Promise<PlanningSoListResponse> {
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // ── Sales Orders ──────────────────────────────────────────────────────
    // 1. Open SO headers + per-line totals (aggregated in SQL).
    const soRows = await tx
      .select({
        soId: salesOrders.id,
        soCode: salesOrders.code,
        customerName: salesOrders.customerName,
        soType: salesOrders.type,
        totalLines: sql<number>`count(${salesOrderLines.id})::int`.as('total_lines'),
        totalQty: sql<number>`coalesce(sum(${salesOrderLines.orderQty}), 0)::int`.as('total_qty'),
        // ADR-185 — per line, by the one shared rule (lib/so-line-coverage.ts):
        // Plan Qty = plans + a Buy line's PRs (the detail pane's totalPlanned);
        // the % uses covered (+ direct cards) capped at the line qty, so one
        // over-covered line cannot hide another's gap.
        plannedQty:
          sql<number>`coalesce(sum(${sql.raw(soLinePlannedRaw('"sales_order_lines"'))}), 0)::int`.as(
            'planned_qty',
          ),
        coveredQty:
          sql<number>`coalesce(sum(LEAST(${sql.raw(soLineCoveredRaw('"sales_order_lines"'))}, ${salesOrderLines.orderQty})), 0)::int`.as(
            'covered_qty',
          ),
        maxDueDate: sql<string | null>`max(${salesOrderLines.dueDate})::text`.as('max_due'),
        // Aggregated item code + part name across this SO's lines, for the
        // client-side item search on the Planning page.
        itemsText:
          sql<string>`coalesce(string_agg(distinct trim(coalesce(${salesOrderLines.itemCodeText}, '') || ' ' || coalesce(${salesOrderLines.partName}, '')), ' '), '')`.as(
            'items_text',
          ),
      })
      .from(salesOrders)
      .leftJoin(
        salesOrderLines,
        and(
          eq(salesOrderLines.salesOrderId, salesOrders.id),
          isNull(salesOrderLines.deletedAt),
          // ADR-185 — the same lines the detail pane lists (a produced line
          // still counts toward the order's totals); only cancelled ones drop.
          sql`${salesOrderLines.status} <> 'cancelled'`,
        ),
      )
      .where(
        and(
          eq(salesOrders.companyId, companyId),
          isNull(salesOrders.deletedAt),
          eq(salesOrders.status, 'open'),
        ),
      )
      .groupBy(salesOrders.id, salesOrders.code, salesOrders.customerName, salesOrders.type)
      .orderBy(desc(salesOrders.code));

    // ADR-185 — planned / PR / direct-JC coverage per SO now comes from the
    // shared rule in the select above (lib/so-line-coverage.ts).

    // ── Job Work Orders ───────────────────────────────────────────────────
    // Same shape as SO but off job_work_orders / job_work_order_lines and the
    // plans.jw_line_id link. JWs are plannable identically to SOs (full parity).
    const jwRows = await tx
      .select({
        soId: jobWorkOrders.id,
        soCode: jobWorkOrders.code,
        customerName: jobWorkOrders.customerName,
        totalLines: sql<number>`count(${jobWorkOrderLines.id})::int`.as('total_lines'),
        totalQty: sql<number>`coalesce(sum(${jobWorkOrderLines.orderQty}), 0)::int`.as('total_qty'),
        maxDueDate: sql<string | null>`max(${jobWorkOrderLines.dueDate})::text`.as('max_due'),
        itemsText:
          sql<string>`coalesce(string_agg(distinct trim(coalesce(${jobWorkOrderLines.itemCodeText}, '') || ' ' || coalesce(${jobWorkOrderLines.partName}, '')), ' '), '')`.as(
            'items_text',
          ),
      })
      .from(jobWorkOrders)
      .leftJoin(
        jobWorkOrderLines,
        and(
          eq(jobWorkOrderLines.jobWorkOrderId, jobWorkOrders.id),
          isNull(jobWorkOrderLines.deletedAt),
          // ADR-185 — same line set as the SO rows and the JW detail pane.
          sql`${jobWorkOrderLines.status} <> 'cancelled'`,
        ),
      )
      .where(
        and(
          eq(jobWorkOrders.companyId, companyId),
          isNull(jobWorkOrders.deletedAt),
          eq(jobWorkOrders.status, 'open'),
        ),
      )
      .groupBy(jobWorkOrders.id, jobWorkOrders.code, jobWorkOrders.customerName)
      .orderBy(desc(jobWorkOrders.code));

    const jwIds = jwRows.map((r) => r.soId);

    const jwPlannedAgg =
      jwIds.length === 0
        ? []
        : await tx
            .select({
              soId: jobWorkOrders.id,
              plannedQty: sql<number>`coalesce(sum(${plans.planQty}), 0)::int`.as('planned_qty'),
            })
            .from(plans)
            .innerJoin(jobWorkOrderLines, eq(jobWorkOrderLines.id, plans.jwLineId))
            .innerJoin(jobWorkOrders, eq(jobWorkOrders.id, jobWorkOrderLines.jobWorkOrderId))
            .where(
              and(
                inArray(jobWorkOrders.id, jwIds),
                isNull(plans.deletedAt),
                sql`${plans.planStatus} <> 'cancelled'`,
              ),
            )
            .groupBy(jobWorkOrders.id);
    const jwPlannedMap = new Map<string, number>();
    for (const r of jwPlannedAgg) jwPlannedMap.set(r.soId, Number(r.plannedQty));

    const jwDirectAgg =
      jwIds.length === 0
        ? []
        : await tx
            .select({
              soId: jobWorkOrders.id,
              directQty: sql<number>`coalesce(sum(${jobCards.orderQty}), 0)::int`.as('direct_qty'),
            })
            .from(jobCards)
            .innerJoin(jobWorkOrderLines, eq(jobWorkOrderLines.id, jobCards.sourceJwLineId))
            .innerJoin(jobWorkOrders, eq(jobWorkOrders.id, jobWorkOrderLines.jobWorkOrderId))
            .leftJoin(
              plans,
              and(
                eq(plans.jcId, jobCards.id),
                isNull(plans.deletedAt),
                sql`${plans.planStatus} <> 'cancelled'`,
              ),
            )
            .where(
              and(
                inArray(jobWorkOrders.id, jwIds),
                isNull(jobCards.deletedAt),
                isNull(plans.id),
                // ADR-185 — only a card for the line's own item is direct cover.
                sql`${jobCards.itemId} IS NOT DISTINCT FROM ${jobWorkOrderLines.itemId}`,
                // ADR-185 — a Production Order's card belongs to its plan (the
                // plan's Covered counts it); only order-less cards are direct.
                isNull(jobCards.productionOrderId),
                // Rework/repair children are not extra coverage (gap 3).
                isNull(jobCards.recoveryKind),
              ),
            )
            .groupBy(jobWorkOrders.id);
    const jwDirectMap = new Map<string, number>();
    for (const r of jwDirectAgg) jwDirectMap.set(r.soId, Number(r.directQty));

    const buildItem = (
      r: {
        soId: string;
        soCode: string;
        customerName: string | null;
        totalLines: number;
        totalQty: number;
        maxDueDate: string | null;
        itemsText: string;
      },
      source: 'so' | 'jw',
      soType: string,
      planned: number,
      direct: number,
      /** ADR-185 — covered qty already capped per line (SO rows); JW rows
       *  still pass planned + direct. */
      coveredForPct?: number,
    ) => {
      const totalQty = Number(r.totalQty);
      const coveredQty = coveredForPct ?? planned + direct;
      const pct = totalQty > 0 ? Math.min(100, Math.round((coveredQty / totalQty) * 100)) : 0;
      return {
        soId: r.soId,
        soCode: r.soCode,
        source,
        customerName: r.customerName ?? null,
        soType,
        dueDate: r.maxDueDate ?? null,
        totalLines: Number(r.totalLines),
        totalQty,
        totalPlannedQty: planned,
        planningPct: pct,
        planningStatus: classifyPlanningPct(pct),
        itemsText: r.itemsText ?? '',
      };
    };

    // Named `listItems`, not `items`: that name is the items TABLE in this
    // module (the coverage and PR reads above join it).
    const listItems = [
      ...soRows.map((r) =>
        buildItem(r, 'so', r.soType, Number(r.plannedQty ?? 0), 0, Number(r.coveredQty ?? 0)),
      ),
      ...jwRows.map((r) =>
        buildItem(r, 'jw', 'job_work', jwPlannedMap.get(r.soId) ?? 0, jwDirectMap.get(r.soId) ?? 0),
      ),
    ];

    return { generatedAt: new Date().toISOString(), items: listItems };
  });
}

// ─── Right pane ──────────────────────────────────────────────────────────

export async function getPlanningSoDetail(
  soId: string,
  user: AuthContext,
): Promise<PlanningDetailResponse> {
  if (!UUID_RE.test(soId)) throw new ValidationError('Sales Order not found. Refresh the page.');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // 1. SO header.
    const soRows = await tx
      .select({
        id: salesOrders.id,
        code: salesOrders.code,
        customerName: salesOrders.customerName,
        type: salesOrders.type,
        clientPoNo: salesOrders.clientPoNo,
        bomMasterId: salesOrders.bomMasterId,
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.id, soId),
          eq(salesOrders.companyId, companyId),
          isNull(salesOrders.deletedAt),
        ),
      )
      .limit(1);
    const so = soRows[0];
    // Not an SO id → try a Job Work Order (JWs are planned identically).
    if (!so) return getJwPlanningDetail(tx, soId, companyId);

    // 2. Lines + items (in 1 query).
    const lineRows = await tx
      .select({
        line: salesOrderLines,
        itemCode: items.code,
        itemName: items.name,
        itemType: items.itemType,
        itemProcurementType: items.procurementType,
        // The customer's drawing revision typed on this SO line. Selected as its
        // own cast expression rather than read off `line` because the contract
        // types it as a string, and a database that has not had migration 0119
        // still holds the old integer there — the cast is a no-op once 0119 is
        // in. It is never items.revision, a different column about the item
        // master.
        itemRevision: sql<string | null>`${salesOrderLines.revision}::text`,
      })
      .from(salesOrderLines)
      .leftJoin(items, and(eq(items.id, salesOrderLines.itemId), isNull(items.deletedAt)))
      .where(
        and(
          eq(salesOrderLines.salesOrderId, soId),
          isNull(salesOrderLines.deletedAt),
          // ADR-185 — the same line set as the left-pane totals.
          sql`${salesOrderLines.status} <> 'cancelled'`,
        ),
      )
      .orderBy(asc(salesOrderLines.lineNo));

    const lineIds = lineRows.map((r) => r.line.id);

    // 3. Plans + linked JC code + PR codes.
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
              poId: PLAN_LATEST_ORDER_ID_SQL,
              poCode: PLAN_LATEST_ORDER_CODE_SQL,
              poStatus: PLAN_LATEST_ORDER_STATUS_SQL,
              activeOrderCount: PLAN_ACTIVE_ORDER_COUNT_SQL,
              openOrderCount: PLAN_OPEN_ORDER_COUNT_SQL,
              pendingQty: PLAN_PENDING_QTY_SQL,
              hasRouteCard: HAS_ROUTE_CARD_SQL,
            })
            .from(plans)
            .leftJoin(jobCards, eq(jobCards.id, plans.jcId))
            .leftJoin(sql`${purchaseRequests} as dp_pr`, sql`dp_pr.id = ${plans.dpPrId}`)
            .leftJoin(sql`${purchaseRequests} as fo_pr`, sql`fo_pr.id = ${plans.foPrId}`)
            .leftJoin(sql`${purchaseRequests} as fo_mat_pr`, sql`fo_mat_pr.id = ${plans.foMatPrId}`)
            .where(
              and(
                inArray(plans.soLineId, lineIds),
                isNull(plans.deletedAt),
                sql`${plans.planStatus} <> 'cancelled'`,
              ),
            )
            .orderBy(asc(plans.code));

    const planIds = planRows.map((r) => r.plan.id);
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

    // 5. Bucket plans by line + build summaries.
    const plansByLine = new Map<string, PlanningPlanSummary[]>();
    for (const r of planRows) {
      if (!r.plan.soLineId) continue;
      const ops = opsCountMap.get(r.plan.id) ?? { count: 0, hasOutsource: false };
      const summary: PlanningPlanSummary = {
        id: r.plan.id,
        code: r.plan.code,
        planType: r.plan.planType,
        planStatus: r.plan.planStatus,
        ...routeCardPlanFields(r),
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
      const bucket = plansByLine.get(r.plan.soLineId);
      if (bucket) bucket.push(summary);
      else plansByLine.set(r.plan.soLineId, [summary]);
    }

    // 6. Equipment-SO BOM lookup (single BOM at the SO header).
    const isEquipmentSo = so.type === 'equipment';
    const equipBomId =
      isEquipmentSo && so.bomMasterId && UUID_RE.test(so.bomMasterId) ? so.bomMasterId : null;

    // 7. Assembly-line BOM lookup (per line via sourceBomMasterId).
    const assemblyBomIds = lineRows
      .map((r) => r.line.sourceBomMasterId)
      .filter((id): id is string => id !== null && UUID_RE.test(id));
    const allBomIds = [...new Set([...(equipBomId ? [equipBomId] : []), ...assemblyBomIds])];

    const bomHeaders =
      allBomIds.length === 0
        ? []
        : await tx
            .select({
              id: bomMasters.id,
              bomNo: bomMasters.bomNo,
            })
            .from(bomMasters)
            .where(and(inArray(bomMasters.id, allBomIds), isNull(bomMasters.deletedAt)));
    const bomHeaderMap = new Map<string, string>();
    for (const b of bomHeaders) bomHeaderMap.set(b.id, b.bomNo);

    const bomPartsAgg =
      allBomIds.length === 0
        ? []
        : await tx
            .select({
              bomMasterId: bomMasterLines.bomMasterId,
              c: count(),
            })
            .from(bomMasterLines)
            .where(
              and(inArray(bomMasterLines.bomMasterId, allBomIds), isNull(bomMasterLines.deletedAt)),
            )
            .groupBy(bomMasterLines.bomMasterId);
    const bomPartsMap = new Map<string, number>();
    for (const r of bomPartsAgg) bomPartsMap.set(r.bomMasterId, Number(r.c));

    // 7b. Job Cards created directly against these SO lines WITHOUT a plan
    // (sourceSoLineId set, not referenced by any non-cancelled plan.jcId).
    // These are real production the plans table can't see — counted as covered
    // so Planning stops reporting "yet to plan" while SO Status shows progress.
    const linkedJcIds = new Set(
      planRows.map((r) => r.plan.jcId).filter((id): id is string => id !== null),
    );
    const jcRows =
      lineIds.length === 0
        ? []
        : await tx
            .select({
              id: jobCards.id,
              code: jobCards.code,
              soLineId: jobCards.sourceSoLineId,
              itemId: jobCards.itemId,
              orderQty: jobCards.orderQty,
            })
            .from(jobCards)
            .where(
              and(
                inArray(jobCards.sourceSoLineId, lineIds),
                isNull(jobCards.deletedAt),
                // ADR-185 — a Production Order's card belongs to its plan, never
                // a direct card, whether or not it is the plan's jc_id.
                isNull(jobCards.productionOrderId),
                // Rework/repair children are not extra coverage (gap 3, see
                // the list aggregate above).
                isNull(jobCards.recoveryKind),
              ),
            )
            .orderBy(asc(jobCards.code));
    const directJcByLine = new Map<string, { qty: number; codes: string[] }>();
    // ADR-185 — only a card for the line's OWN item is direct coverage; a BOM
    // cascade's child cards (other items on the parent line) are not.
    const lineItemById = new Map(lineRows.map((r) => [r.line.id, r.line.itemId]));
    for (const jc of jcRows) {
      if (!jc.soLineId || linkedJcIds.has(jc.id)) continue;
      if ((jc.itemId ?? null) !== (lineItemById.get(jc.soLineId) ?? null)) continue;
      const entry = directJcByLine.get(jc.soLineId) ?? { qty: 0, codes: [] };
      entry.qty += jc.orderQty;
      entry.codes.push(jc.code);
      directJcByLine.set(jc.soLineId, entry);
    }

    // 7c. The three stock numbers per line item, in ONE query (ADR-180). The
    // planner needs all three: PHYSICAL says what is on the shelf, RESERVED how
    // much of it is already promised, AVAILABLE what this order may still take.
    // Read through lib/stock-reservation so this screen can never disagree with
    // the dispatch or production-close paths about what is reserved.
    const lineItemIds = [
      ...new Set(lineRows.map((r) => r.line.itemId).filter((id): id is string => id !== null)),
    ];
    const positionByItem = await readStockPositions(tx, companyId, lineItemIds);

    // 7d. Of that reserved total, how much is booked to THIS line — one query
    // for every line, never one per line.
    const reservedByLine = await readReservedByLine(tx, companyId, lineIds);

    // 7e. ADR-171 — purchase requests raised from the line (buy items).
    const prsByLine = await loadPrsByLine(tx, companyId, lineIds);

    // 8. Compose lines.
    const lines: PlanningLine[] = lineRows.map((r) => {
      const linePlans = plansByLine.get(r.line.id) ?? [];
      const itemProcurementType = toProcurementType(r.itemProcurementType);
      const linePrs = prsByLine.get(r.line.id) ?? { prs: [], prQty: 0 };
      // ADR-171: on a BUY line the PRs are the plan — their live qty counts as
      // planned. On a make line they are reported but change no number.
      const totalPlanned =
        linePlans.reduce((s, p) => s + p.planQty, 0) +
        (itemProcurementType === 'buy' ? linePrs.prQty : 0);
      const orderQty = r.line.orderQty;
      const direct = directJcByLine.get(r.line.id);
      const directJcQty = direct?.qty ?? 0;
      const directJcCodes = direct?.codes ?? [];
      const coveredQty = totalPlanned + directJcQty;
      const remaining = Math.max(0, orderQty - coveredQty);
      const position = r.line.itemId ? positionByItem.get(r.line.itemId) : undefined;
      const physicalQty = Math.max(0, position?.physicalQty ?? 0);
      const totalReservedQty = Math.max(0, position?.reservedQty ?? 0);
      const availableQty = Math.max(0, position?.availableQty ?? 0);
      const reservedQty = reservedByLine.get(r.line.id) ?? 0;
      const dispatchedQty = Math.max(0, Number(r.line.dispatchedQty ?? 0));
      // What still has to be made or bought. Stock already booked to THIS line
      // covers part of the order, so planning it again would double-count it.
      const balanceToPlan = Math.max(0, orderQty - dispatchedQty - reservedQty);
      const pct = orderQty > 0 ? Math.round((coveredQty / orderQty) * 100) : 0;

      const hasEquipmentBom = isEquipmentSo && equipBomId !== null;
      const hasAssemblyBom =
        !isEquipmentSo &&
        r.line.sourceBomMasterId !== null &&
        UUID_RE.test(r.line.sourceBomMasterId);

      const activeBomId = hasEquipmentBom
        ? equipBomId
        : hasAssemblyBom
          ? r.line.sourceBomMasterId
          : null;
      const activeBomNo = activeBomId ? (bomHeaderMap.get(activeBomId) ?? null) : null;
      const activeBomParts = activeBomId ? (bomPartsMap.get(activeBomId) ?? 0) : 0;

      return {
        soLineId: r.line.id,
        lineNo: r.line.lineNo,
        clientPoLineNo: r.line.clientPoLineNo,
        itemId: r.line.itemId,
        itemCode: r.itemCode ?? r.line.itemCodeText,
        // Null passed through, not blanked: on a database that predates
        // migration 0119 the line may genuinely carry no revision, and the
        // screen must then show the bare code rather than a trailing slash.
        itemRevision: r.itemRevision ?? null,
        itemName: r.itemName ?? r.line.partName,
        orderQty,
        dueDate: r.line.dueDate,
        itemProcurementType,
        prQty: linePrs.prQty,
        prs: linePrs.prs,
        plans: linePlans,
        totalPlanned,
        directJcQty,
        directJcCodes,
        remaining,
        // `stockQty` keeps its name and its meaning — "how much may I still
        // use" — which is now AVAILABLE, not on-hand (ADR-180).
        stockQty: availableQty,
        reservedQty,
        physicalQty,
        totalReservedQty,
        dispatchedQty,
        availableQty,
        balanceToPlan,
        lineStatus: classifyPlanningPct(pct),
        hasEquipmentBom,
        hasAssemblyBom,
        bomMasterId: activeBomId,
        bomNo: activeBomNo,
        bomPartsCount: activeBomParts,
      };
    });

    return {
      soId: so.id,
      soCode: so.code,
      source: 'so' as const,
      customerName: so.customerName ?? null,
      soType: so.type,
      dueDate: lines.reduce<string | null>((max, l) => {
        if (!l.dueDate) return max;
        if (!max || l.dueDate > max) return l.dueDate;
        return max;
      }, null),
      clientPoNo: so.clientPoNo ?? null,
      lines,
    };
  });
}

// ─── Right pane: per-JW detail ───────────────────────────────────────────
// JW parity port of getPlanningSoDetail. Reads job_work_orders /
// job_work_order_lines and links plans via plans.jw_line_id + direct JCs via
// job_cards.source_jw_line_id. JW lines carry no BOM master, so the Equipment
// and assembly-BOM branches are always off here.
async function getJwPlanningDetail(
  tx: DbTransaction,
  jwId: string,
  companyId: string,
): Promise<PlanningDetailResponse> {
  // 1. JW header.
  const jwRows = await tx
    .select({
      id: jobWorkOrders.id,
      code: jobWorkOrders.code,
      customerName: jobWorkOrders.customerName,
      clientPoNo: jobWorkOrders.clientPoNo,
    })
    .from(jobWorkOrders)
    .where(
      and(
        eq(jobWorkOrders.id, jwId),
        eq(jobWorkOrders.companyId, companyId),
        isNull(jobWorkOrders.deletedAt),
      ),
    )
    .limit(1);
  const jw = jwRows[0];
  if (!jw) throw new NotFoundError('Sales Order / JWSO not found. Refresh the page.');

  // 2. Lines + items.
  const lineRows = await tx
    .select({
      line: jobWorkOrderLines,
      itemCode: items.code,
      itemName: items.name,
      itemProcurementType: items.procurementType,
    })
    .from(jobWorkOrderLines)
    .leftJoin(items, and(eq(items.id, jobWorkOrderLines.itemId), isNull(items.deletedAt)))
    .where(
      and(
        eq(jobWorkOrderLines.jobWorkOrderId, jwId),
        isNull(jobWorkOrderLines.deletedAt),
        // ADR-185 — the same line set as the left-pane totals.
        sql`${jobWorkOrderLines.status} <> 'cancelled'`,
      ),
    )
    .orderBy(asc(jobWorkOrderLines.lineNo));

  const lineIds = lineRows.map((r) => r.line.id);

  // 3. Plans + linked JC code + PR codes (via plans.jw_line_id).
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
            poId: PLAN_LATEST_ORDER_ID_SQL,
            poCode: PLAN_LATEST_ORDER_CODE_SQL,
            poStatus: PLAN_LATEST_ORDER_STATUS_SQL,
            activeOrderCount: PLAN_ACTIVE_ORDER_COUNT_SQL,
            openOrderCount: PLAN_OPEN_ORDER_COUNT_SQL,
            pendingQty: PLAN_PENDING_QTY_SQL,
            hasRouteCard: HAS_ROUTE_CARD_SQL,
          })
          .from(plans)
          .leftJoin(jobCards, eq(jobCards.id, plans.jcId))
          .leftJoin(sql`${purchaseRequests} as dp_pr`, sql`dp_pr.id = ${plans.dpPrId}`)
          .leftJoin(sql`${purchaseRequests} as fo_pr`, sql`fo_pr.id = ${plans.foPrId}`)
          .leftJoin(sql`${purchaseRequests} as fo_mat_pr`, sql`fo_mat_pr.id = ${plans.foMatPrId}`)
          .where(
            and(
              inArray(plans.jwLineId, lineIds),
              isNull(plans.deletedAt),
              sql`${plans.planStatus} <> 'cancelled'`,
            ),
          )
          .orderBy(asc(plans.code));

  const planIds = planRows.map((r) => r.plan.id);
  const ospPrsMap = await loadOspPrsByPlan(
    tx,
    planRows.map((r) => ({ id: r.plan.id, jcId: r.plan.jcId ?? null })),
  );

  // 4. Ops counts per plan.
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

  // 5. Bucket plans by line.
  const plansByLine = new Map<string, PlanningPlanSummary[]>();
  for (const r of planRows) {
    if (!r.plan.jwLineId) continue;
    const ops = opsCountMap.get(r.plan.id) ?? { count: 0, hasOutsource: false };
    const summary: PlanningPlanSummary = {
      id: r.plan.id,
      code: r.plan.code,
      planType: r.plan.planType,
      planStatus: r.plan.planStatus,
      ...routeCardPlanFields(r),
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
    const bucket = plansByLine.get(r.plan.jwLineId);
    if (bucket) bucket.push(summary);
    else plansByLine.set(r.plan.jwLineId, [summary]);
  }

  // 6. Direct (plan-less) Job Cards against these JW lines.
  const linkedJcIds = new Set(
    planRows.map((r) => r.plan.jcId).filter((id): id is string => id !== null),
  );
  const jcRows =
    lineIds.length === 0
      ? []
      : await tx
          .select({
            id: jobCards.id,
            code: jobCards.code,
            jwLineId: jobCards.sourceJwLineId,
            itemId: jobCards.itemId,
            orderQty: jobCards.orderQty,
          })
          .from(jobCards)
          .where(
            and(
              inArray(jobCards.sourceJwLineId, lineIds),
              isNull(jobCards.deletedAt),
              // ADR-185 — a Production Order's card belongs to its plan.
              isNull(jobCards.productionOrderId),
            ),
          )
          .orderBy(asc(jobCards.code));
  const directJcByLine = new Map<string, { qty: number; codes: string[] }>();
  // ADR-185 — only a card for the line's OWN item is direct coverage.
  const jwLineItemById = new Map(lineRows.map((r) => [r.line.id, r.line.itemId]));
  for (const jc of jcRows) {
    if (!jc.jwLineId || linkedJcIds.has(jc.id)) continue;
    if ((jc.itemId ?? null) !== (jwLineItemById.get(jc.jwLineId) ?? null)) continue;
    const entry = directJcByLine.get(jc.jwLineId) ?? { qty: 0, codes: [] };
    entry.qty += jc.orderQty;
    entry.codes.push(jc.code);
    directJcByLine.set(jc.jwLineId, entry);
  }

  // 6b. PHYSICAL / RESERVED / AVAILABLE per line item — see the SO branch (7c).
  const lineItemIds = [
    ...new Set(lineRows.map((r) => r.line.itemId).filter((id): id is string => id !== null)),
  ];
  const positionByItem = await readStockPositions(tx, companyId, lineItemIds);

  // 6c. Reserved to each line (a JW line books against the same column).
  const reservedByLine = await readReservedByLine(tx, companyId, lineIds);

  // 7. Compose lines. JW lines have no BOM master → BOM branches always off.
  const lines: PlanningLine[] = lineRows.map((r) => {
    const linePlans = plansByLine.get(r.line.id) ?? [];
    const totalPlanned = linePlans.reduce((s, p) => s + p.planQty, 0);
    const orderQty = r.line.orderQty;
    const direct = directJcByLine.get(r.line.id);
    const directJcQty = direct?.qty ?? 0;
    const directJcCodes = direct?.codes ?? [];
    const coveredQty = totalPlanned + directJcQty;
    const remaining = Math.max(0, orderQty - coveredQty);
    const position = r.line.itemId ? positionByItem.get(r.line.itemId) : undefined;
    const physicalQty = Math.max(0, position?.physicalQty ?? 0);
    const totalReservedQty = Math.max(0, position?.reservedQty ?? 0);
    const availableQty = Math.max(0, position?.availableQty ?? 0);
    const reservedQty = reservedByLine.get(r.line.id) ?? 0;
    // A job-work line has no customer dispatch counter: `dispatched_qty` is a
    // sales-order column and `returned_qty` next door counts the OWNER's
    // material going home, which is a different fact and must not be passed off
    // as a dispatch. 0 is the honest answer here.
    const dispatchedQty = 0;
    const balanceToPlan = Math.max(0, orderQty - dispatchedQty - reservedQty);
    const pct = orderQty > 0 ? Math.round((coveredQty / orderQty) * 100) : 0;

    return {
      soLineId: r.line.id,
      lineNo: r.line.lineNo,
      clientPoLineNo: null,
      itemId: r.line.itemId,
      itemCode: r.itemCode ?? r.line.itemCodeText,
      // ADR-177: the JW line carries its own drawing revision (the customer's
      // Rev typed on the JWSO line), read live off the line so the screen shows
      // CODE/REV for job-work lines just as it does for SO lines. An empty
      // Rev (allowed on a JW line) comes back null → bare item code.
      itemRevision: r.line.revision || null,
      itemName: r.itemName ?? r.line.partName,
      orderQty,
      dueDate: r.line.dueDate,
      // ADR-171: a job-work line is the client's material — never bought in,
      // so no PRs and nothing to count. The flag is still reported as-is.
      itemProcurementType: toProcurementType(r.itemProcurementType),
      prQty: 0,
      prs: [],
      plans: linePlans,
      totalPlanned,
      directJcQty,
      directJcCodes,
      remaining,
      stockQty: availableQty,
      reservedQty,
      physicalQty,
      totalReservedQty,
      dispatchedQty,
      availableQty,
      balanceToPlan,
      lineStatus: classifyPlanningPct(pct),
      hasEquipmentBom: false,
      hasAssemblyBom: false,
      bomMasterId: null,
      bomNo: null,
      bomPartsCount: 0,
    };
  });

  return {
    soId: jw.id,
    soCode: jw.code,
    source: 'jw' as const,
    customerName: jw.customerName ?? null,
    soType: 'job_work',
    dueDate: lines.reduce<string | null>((max, l) => {
      if (!l.dueDate) return max;
      if (!max || l.dueDate > max) return l.dueDate;
      return max;
    }, null),
    clientPoNo: jw.clientPoNo ?? null,
    lines,
  };
}

// ─── BOM-planning aggregator (§8 + §9) ───────────────────────────────────

export async function getPlanningBom(
  soLineId: string,
  user: AuthContext,
): Promise<PlanningBomResponse> {
  if (!UUID_RE.test(soLineId))
    throw new ValidationError('Sales Order line not found. Refresh the page.');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // 1. SO line + its parent SO + the parent item (Equipment).
    const rows = await tx
      .select({
        line: salesOrderLines,
        soCode: salesOrders.code,
        soType: salesOrders.type,
        soBomMasterId: salesOrders.bomMasterId,
        itemCode: items.code,
        itemName: items.name,
        itemType: items.itemType,
      })
      .from(salesOrderLines)
      .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
      .leftJoin(items, eq(items.id, salesOrderLines.itemId))
      .where(
        and(
          eq(salesOrderLines.id, soLineId),
          eq(salesOrders.companyId, companyId),
          isNull(salesOrderLines.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Sales Order line not found. Refresh the page.');

    // Resolve which BOM to use: Equipment SO uses parent SO's bomMasterId;
    // otherwise the line's sourceBomMasterId.
    const isEquipment = row.soType === 'equipment';
    const bomId =
      isEquipment && row.soBomMasterId && UUID_RE.test(row.soBomMasterId)
        ? row.soBomMasterId
        : row.line.sourceBomMasterId;
    if (!bomId) {
      throw new ValidationError(
        `SO ${row.soCode} Ln ${row.line.lineNo} has no BOM. Link a BOM on the Sales Order first.`,
      );
    }

    // 2. BOM header.
    const bomHeaders = await tx
      .select({
        id: bomMasters.id,
        bomNo: bomMasters.bomNo,
        revision: bomMasters.revision,
      })
      .from(bomMasters)
      .where(
        and(
          eq(bomMasters.id, bomId),
          eq(bomMasters.companyId, companyId),
          isNull(bomMasters.deletedAt),
        ),
      )
      .limit(1);
    const bom = bomHeaders[0];
    if (!bom) throw new NotFoundError('BOM not found. It may have been moved to Trash.');

    // 3. BOM lines + child items.
    const childRows = await tx
      .select({
        bml: bomMasterLines,
        childCode: items.code,
        childName: items.name,
      })
      .from(bomMasterLines)
      .innerJoin(items, eq(items.id, bomMasterLines.childItemId))
      .where(and(eq(bomMasterLines.bomMasterId, bomId), isNull(bomMasterLines.deletedAt)))
      .orderBy(asc(bomMasterLines.lineNo));

    if (childRows.length === 0) {
      return {
        soLineId,
        soCode: row.soCode,
        bomMasterId: bom.id,
        bomNo: bom.bomNo,
        bomRev: bom.revision,
        parentItemCode: row.itemCode ?? row.line.itemCodeText,
        // Both read straight off the parent SO line this BOM hangs from.
        parentItemRevision: row.line.revision ?? null,
        parentClientPoLineNo: row.line.clientPoLineNo ?? null,
        parentItemName: row.itemName ?? row.line.partName,
        orderQty: row.line.orderQty,
        supportsAssemblyPlan: !isEquipment && row.itemType === 'assembly',
        hasAssemblyPlan: false,
        children: [],
      };
    }

    const childItemIds = childRows.map((r) => r.bml.childItemId);

    // 4. Stock per child item.
    const stockRows =
      childItemIds.length === 0
        ? []
        : await tx
            .select({
              itemId: itemStockBalances.itemId,
              qty: itemStockBalances.onHandQty,
            })
            .from(itemStockBalances)
            .where(
              and(
                eq(itemStockBalances.companyId, companyId),
                inArray(itemStockBalances.itemId, childItemIds),
              ),
            );
    const stockMap = new Map<string, number>();
    for (const s of stockRows) stockMap.set(s.itemId, Number(s.qty));

    // 5. Existing plans on this SO line × per child code.
    const existing = await tx
      .select({
        plan: plans,
        jcCode: jobCards.code,
        poId: PLAN_LATEST_ORDER_ID_SQL,
        poCode: PLAN_LATEST_ORDER_CODE_SQL,
        poStatus: PLAN_LATEST_ORDER_STATUS_SQL,
        activeOrderCount: PLAN_ACTIVE_ORDER_COUNT_SQL,
        openOrderCount: PLAN_OPEN_ORDER_COUNT_SQL,
        pendingQty: PLAN_PENDING_QTY_SQL,
        hasRouteCard: HAS_ROUTE_CARD_SQL,
      })
      .from(plans)
      .leftJoin(jobCards, eq(jobCards.id, plans.jcId))
      .where(
        and(
          eq(plans.soLineId, soLineId),
          isNull(plans.deletedAt),
          sql`${plans.planStatus} <> 'cancelled'`,
        ),
      );
    const planByChildCode = new Map<string, PlanningPlanSummary>();
    let hasAssemblyPlan = false;
    for (const r of existing) {
      if (r.plan.planType === 'assembly') {
        hasAssemblyPlan = true;
        continue;
      }
      const childCode = r.plan.bomChildCode;
      if (!childCode) continue;
      planByChildCode.set(childCode, {
        id: r.plan.id,
        code: r.plan.code,
        planType: r.plan.planType,
        planStatus: r.plan.planStatus,
        ...routeCardPlanFields(r),
        planQty: r.plan.planQty,
        opsCount: 0,
        hasOutsourceOp: false,
        jcId: r.plan.jcId ?? null,
        jcCode: r.jcCode ?? null,
        dpPrId: null,
        dpPrCode: null,
        foPrId: null,
        foPrCode: null,
        foMatPrId: null,
        foMatPrCode: null,
        foVendorCodeText: null,
        ospPrs: [],
      });
    }

    const orderQty = row.line.orderQty;
    const children: PlanningBomChild[] = childRows.map((c) => {
      const qtyPerSet = Number(c.bml.qtyPerSet);
      const totalNeed = qtyPerSet * orderQty;
      const stockQty = stockMap.get(c.bml.childItemId) ?? 0;
      const shortfall = Math.max(0, totalNeed - stockQty);
      const existingPlan = planByChildCode.get(c.childCode) ?? null;
      return {
        childItemId: c.bml.childItemId,
        childItemCode: c.childCode,
        childItemName: c.childName,
        qtyPerSet,
        totalNeed,
        stockQty,
        shortfall,
        bomType: c.bml.bomType,
        existingPlan,
      };
    });

    return {
      soLineId,
      soCode: row.soCode,
      bomMasterId: bom.id,
      bomNo: bom.bomNo,
      bomRev: bom.revision,
      parentItemCode: row.itemCode ?? row.line.itemCodeText,
      // Both read straight off the parent SO line this BOM hangs from.
      parentItemRevision: row.line.revision ?? null,
      parentClientPoLineNo: row.line.clientPoLineNo ?? null,
      parentItemName: row.itemName ?? row.line.partName,
      orderQty,
      supportsAssemblyPlan: !isEquipment && row.itemType === 'assembly',
      hasAssemblyPlan,
      children,
    };
  });
}

// ─── Buy lines: raise a purchase request from the SO line (ADR-171) ──────

/**
 * POST /so-planning/lines/:soLineId/raise-pr
 *
 * For an SO line whose item is `procurement_type='buy'`: raises ONE standard
 * purchase request (IN-PR-#####) for `qty` of the line's item, stamped with
 * `source_so_line_id` so Purchase sees where the demand came from and the
 * Planning line counts it as planned (loadPrsByLine). No plan, no route card,
 * no Production Order — from here the ordinary PR → PO → GRN flow takes over.
 *
 * Refuses: a job-work line (the client's material — never bought in), a make
 * item (plan it instead), and any qty over what the line still has left.
 *
 * Gate is the Planning form (`plan_create` entry), not `pr_create`: this is
 * the planner's one click, exactly like + Plan. The insert is the same one
 * purchase-requests/service.ts createPurchaseRequest does for a standard PR,
 * done here so the remaining-qty check and the write share one transaction.
 */
export async function raisePlanningPr(
  soLineId: string,
  input: RaisePlanningPrInput,
  user: AuthContext,
): Promise<RaisePlanningPrResponse> {
  if (!UUID_RE.test(soLineId))
    throw new ValidationError('Sales Order line not found. Refresh the page.');
  await requireFormAccess(user, 'plan_create', 'entry');
  const companyId = requireCompany(user);

  // withUniqueRetry: two planners raising at the same moment can both compute
  // the same next IN-PR-##### — the loser re-runs and takes the next number.
  return withUniqueRetry(() =>
    withUserContext(user, async (tx) => {
      // 1. The SO line, its order and its item.
      const rows = await tx
        .select({
          line: salesOrderLines,
          soCode: salesOrders.code,
          itemCode: items.code,
          itemName: items.name,
          itemProcurementType: items.procurementType,
        })
        .from(salesOrderLines)
        .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
        .leftJoin(items, and(eq(items.id, salesOrderLines.itemId), isNull(items.deletedAt)))
        .where(
          and(
            eq(salesOrderLines.id, soLineId),
            eq(salesOrderLines.companyId, companyId),
            isNull(salesOrderLines.deletedAt),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) {
        // A job-work line id lands here too (same Planning screen, other
        // table). Name the real reason rather than "not found".
        const jw = await tx
          .select({ id: jobWorkOrderLines.id })
          .from(jobWorkOrderLines)
          .where(
            and(
              eq(jobWorkOrderLines.id, soLineId),
              eq(jobWorkOrderLines.companyId, companyId),
              isNull(jobWorkOrderLines.deletedAt),
            ),
          )
          .limit(1);
        if (jw.length > 0) {
          throw new ValidationError(
            'Cannot raise a PR on a JWSO line — the Customer supplies the material.',
          );
        }
        throw new NotFoundError('Sales Order line not found. Refresh the page.');
      }

      // 2. Only a Buy item may be bought from here.
      const itemId = row.line.itemId;
      const itemCode = row.itemCode ?? row.line.itemCodeText ?? '—';
      if (!itemId || !row.itemCode) {
        throw new ValidationError(
          `SO ${row.soCode} Ln ${row.line.lineNo} has no Item Code — pick one on the Sales Order before raising a PR.`,
        );
      }
      if (toProcurementType(row.itemProcurementType) !== 'buy') {
        throw new ValidationError(
          `Item ${itemCode} is set to Make — plan it instead, or set its Source to Buy in Item Master`,
        );
      }

      // 3. What the line still has left to plan — ADR-185: read off the ONE
      //    shared rule (lib/so-line-coverage.ts), the same figure the Planning
      //    line and the Needs Planning table state, never rebuilt by hand here.
      const leftRows = (await tx.execute(sql`
        SELECT GREATEST(sol.order_qty - ${sql.raw(soLineCoveredRaw('sol'))}, 0)::int AS to_plan
        FROM public.sales_order_lines sol
        WHERE sol.id = ${soLineId}::uuid
      `)) as unknown as Array<{ to_plan: number }>;
      const remaining = Number(leftRows[0]?.to_plan ?? 0);
      if (input.qty > remaining) {
        throw new ValidationError(
          `PR Qty (${input.qty}) cannot be more than Pending (${remaining}) on SO ${row.soCode} ` +
            `Ln ${row.line.lineNo}.`,
        );
      }

      // 4. The PR — same insert as a standard PR from the PR form.
      const code = await nextSeriesCode(tx, 'pr', companyId, 'IN-PR-');
      const today = new Date().toISOString().slice(0, 10);
      const userRemark = input.remarks?.trim();
      const remarks =
        `Raised from Planning — SO ${row.soCode} line ${row.line.lineNo}` +
        (userRemark ? ` — ${userRemark}` : '');
      const inserted = await tx
        .insert(purchaseRequests)
        .values({
          companyId,
          code,
          prDate: today,
          status: 'open',
          prType: 'standard',
          // purchase_requests_vendor_check needs a vendor id OR text. Planning
          // does not know the vendor — Purchase picks one on the PO — so the
          // same placeholder the BOM cascade plants goes in here.
          vendorCodeText: 'TBD',
          itemId,
          itemCodeText: row.itemCode,
          itemName: row.itemName ?? row.line.partName,
          qty: input.qty,
          estCost: '0',
          requiredDate: input.requiredDate ?? row.line.dueDate ?? null,
          sourceSoLineId: soLineId,
          remarks,
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning({ id: purchaseRequests.id, code: purchaseRequests.code });
      const pr = inserted[0]!;

      await emitActivityLog(
        tx,
        {
          action: 'CREATE',
          entity: 'PurchaseRequest',
          detail: `${pr.code} — ${row.itemName ?? itemCode} x ${input.qty} (from Planning, SO ${row.soCode} Ln ${row.line.lineNo})`,
          refId: pr.code,
        },
        companyId,
        user,
      );

      return { prId: pr.id, prCode: pr.code };
    }),
  );
}
