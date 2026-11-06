// SO Planning workflow service (PL-4b).
//
// Two read endpoints powering the legacy /planning two-pane workflow:
//
//   GET /so-planning              → left pane SO list with planning %
//   GET /so-planning/:soId        → right pane lines + plans + BOM flags
//   GET /so-planning/:soId/bom/:lineId → §8 + §9 BOM explosion + child plans
//   GET /so-planning/lines        → ADR-268 one row per line (list-lines.ts)
//
// Math + grouping mirror legacy renderSOPlanning (HTML L9299) +
// showEquipBOMPlanning (L8848) + showBOMPlanning (L7116). Reads only, except
// raisePlanningPr (ADR-171) — plan writes still go through plans/service.ts.
//
// Query plan: batched. List endpoint = 2 round-trips. Detail = 3.
// BOM endpoint = 5.

import {
  ActivityAction,
  planningLineStatus,
  soLinePlanCoverage,
  toPlanningLineStatus,
} from '@innovic/shared';
import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type {
  PlanningBomChild,
  PlanningBomResponse,
  PlanningDetailResponse,
  PlanningLine,
  PlanningPlanSummary,
  PlanningSoListQuery,
  PlanningSoListResponse,
  RaisePlanningPrInput,
  RaisePlanningPrResponse,
} from '@innovic/shared';
import {
  bomMasterLines,
  bomMasters,
  itemRevisions,
  items,
  itemStockBalances,
  jobCards,
  jobWorkOrderLines,
  jobWorkOrders,
  plans,
  purchaseRequests,
  routeCards,
  salesOrderLines,
  salesOrders,
} from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { createdByNameSql } from '../../lib/created-by-sql';
import { requireFormAccess } from '../../lib/access';
import { withUniqueRetry } from '../../lib/db-retry';
import { NotFoundError, ValidationError } from '../../lib/errors';
import {
  PLAN_ACTIVE_ORDER_COUNT_SQL,
  PLAN_LATEST_ORDER_CODE_SQL,
  PLAN_LATEST_ORDER_ID_SQL,
  PLAN_LATEST_ORDER_STATUS_SQL,
  PLAN_OPEN_ORDER_COUNT_SQL,
  PLAN_PENDING_QTY_SQL,
} from '../../lib/plan-order-coverage';
import { readReservedByLine, readStockPositions } from '../../lib/stock-reservation';
import { soLineCoveredRaw, soLineDirectJcRaw, soLinePlannedRaw } from '../../lib/so-line-coverage';
import { emitActivityLog } from '../activity-log/service';
import { partyGrnStatusByLine } from '../job-work-orders/customer-rm';
import {
  liveJwCustomerName,
  liveSoCustomerName,
  loadDirectJcsByLine,
  loadPrsByLine,
  requireCompany,
  toProcurementType,
  UUID_RE,
} from './line-facts';
import { pagePlanningSoList } from './list-page';
import {
  HAS_ROUTE_CARD_SQL,
  loadPlanSummariesByLine,
  loadProductionOrdersByPlan,
  PLAN_ITEM_JOIN_ON,
  PLAN_RC_JOIN_ON,
  planItemFields,
  ROUTE_CARD_USABLE_SQL,
  routeCardPlanFields,
} from './plan-summaries';
import { nextSeriesCode } from '../op-entry/osp-cascade';

function classifyPlanningPct(pct: number): 'fully_planned' | 'partial' | 'unplanned' {
  if (pct >= 100) return 'fully_planned';
  if (pct > 0) return 'partial';
  return 'unplanned';
}

// ─── Left pane ───────────────────────────────────────────────────────────

export async function getPlanningSoList(
  user: AuthContext,
  query: PlanningSoListQuery = {},
): Promise<PlanningSoListResponse> {
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // ── Sales Orders ──────────────────────────────────────────────────────
    // 1. Open SO headers + per-line totals (aggregated in SQL).
    const soRows = await tx
      .select({
        soId: salesOrders.id,
        soCode: salesOrders.code,
        soInternalNo: salesOrders.internalSoNo,
        // ADR-261 Created On — the order's own created_at.
        createdAt: salesOrders.createdAt,
        // ADR-261 rev — Created By: who entered the order (same row as Created On).
        createdByName: createdByNameSql(salesOrders.createdBy),
        customerName: liveSoCustomerName().as('customer_name'),
        soType: salesOrders.type,
        totalLines: sql<number>`count(${salesOrderLines.id})::int`.as('total_lines'),
        totalQty: sql<number>`coalesce(sum(${salesOrderLines.orderQty}), 0)::int`.as('total_qty'),
        // ADR-185 — per line, by the one shared rule (lib/so-line-coverage.ts):
        // Plan Qty = plans + a Buy line's PRs (the detail pane's totalPlanned;
        // ADR-221: BOM part plans count as complete sets, equipment lines only);
        // the % uses covered (+ direct cards) capped at the line qty, so one
        // over-covered line cannot hide another's gap. ADR-196 — a line
        // closed short counts as fully covered: nothing more is wanted on it.
        // ADR-221 — planned and direct are computed ONCE per line in the
        // sol_cov LATERAL below; covered = planned + direct is exactly
        // soLineCoveredRaw, without evaluating the planned expression twice.
        plannedQty: sql<number>`coalesce(sum(sol_cov.planned), 0)::numeric`.as('planned_qty'),
        coveredQty:
          sql<number>`coalesce(sum(CASE WHEN ${salesOrderLines.shortClosedAt} IS NOT NULL THEN ${salesOrderLines.orderQty} ELSE LEAST((sol_cov.planned + sol_cov.direct)::numeric, ${salesOrderLines.orderQty}) END), 0)::numeric`.as(
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
      .leftJoin(
        sql`LATERAL (SELECT ${sql.raw(soLinePlannedRaw('"sales_order_lines"'))} AS planned,
                            ${sql.raw(soLineDirectJcRaw('"sales_order_lines"'))} AS direct) AS sol_cov`,
        sql`true`,
      )
      .where(
        and(
          eq(salesOrders.companyId, companyId),
          isNull(salesOrders.deletedAt),
          eq(salesOrders.status, 'open'),
        ),
      )
      .groupBy(
        salesOrders.id,
        salesOrders.code,
        salesOrders.internalSoNo,
        salesOrders.createdAt,
        salesOrders.createdBy,
        salesOrders.customerName,
        salesOrders.type,
      )
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
        createdAt: jobWorkOrders.createdAt,
        // ADR-261 rev — Created By: who entered the JWSO (same row as Created On).
        createdByName: createdByNameSql(jobWorkOrders.createdBy),
        customerName: liveJwCustomerName().as('customer_name'),
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
      .groupBy(
        jobWorkOrders.id,
        jobWorkOrders.code,
        jobWorkOrders.createdAt,
        jobWorkOrders.createdBy,
        jobWorkOrders.customerName,
      )
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
        soInternalNo?: string | null;
        createdAt: Date | string | null;
        createdByName: string | null;
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
        soInternalNo: r.soInternalNo ?? null,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : (r.createdAt ?? null),
        createdByName: r.createdByName ?? null,
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

    // ADR-201 — source / search / Sort & Filter / page, over every order.
    return pagePlanningSoList(listItems, query);
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
        internalSoNo: salesOrders.internalSoNo,
        customerName: liveSoCustomerName(),
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
        // ADR-261 rev — Created By: who entered the SO line (same row as Created On).
        createdByName: createdByNameSql(salesOrderLines.createdBy),
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
        // Item + Drawing Rev register (ABC/1) — the line's own Rev.
        drawingRev: itemRevisions.rev,
      })
      .from(salesOrderLines)
      .leftJoin(items, and(eq(items.id, salesOrderLines.itemId), isNull(items.deletedAt)))
      .leftJoin(
        itemRevisions,
        and(eq(itemRevisions.id, salesOrderLines.itemRevisionId), isNull(itemRevisions.deletedAt)),
      )
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

    // 3-5. Plans + linked JC code + PR codes, ops counts, bucketed by line.
    const { planRows, plansByLine } = await loadPlanSummariesByLine(tx, lineIds, 'so');

    // 5b. ADR-216 — the per-part account for a line planned through its BOM.
    //
    // A plan carrying `bom_child_code` is for a CHILD PART and is counted in
    // parts; the line's Plan Qty column is counted in ASSEMBLIES. Adding them
    // gave "Order Qty 1, Plan Qty 20" (10 wheels + 10 gear wheels against one
    // washer) and floored `remaining` to 0, so the line read fully planned
    // while a part could have nothing against it. Instead report what each
    // part needs and what is planned for it, and count COMPLETE SETS — the
    // weakest child governs, the same principle ADR-109 applies to dispatch.
    //
    // A plan is treated as a child plan only when it carries BOTH
    // `bom_master_id` and `bom_child_code`, exactly as ADR-107's create-time
    // cap decides it, so the screen and the cap can never disagree.
    // Keyed by LINE + child code only. NOT by bom_master_id: a line's BOM can be
    // swapped after its plans were raised, and keying on the plan's own BOM made
    // the oldest plan pick the BOM for the whole line, so plans against the
    // line's CURRENT BOM counted zero and the panel listed parts the line no
    // longer uses. The parts come from the line's current BOM below; the plans
    // are matched to them by child code.
    const childPlannedByKey = new Map<string, number>();
    const planBomByLine = new Map<string, string>();
    for (const r of planRows) {
      const lineId = r.plan.soLineId;
      const childCode = r.plan.bomChildCode;
      if (!lineId || !childCode) continue;
      // `planRows` is ordered by plan code, so the LAST write wins: the newest
      // plan's BOM, not the oldest. A line whose BOM was swapped is then
      // measured against the BOM its current plans were actually raised on.
      if (r.plan.bomMasterId) planBomByLine.set(lineId, r.plan.bomMasterId);
      const key = `${lineId}|${childCode}`;
      childPlannedByKey.set(key, (childPlannedByKey.get(key) ?? 0) + r.plan.planQty);
    }

    // Which BOM's parts to list. The line's own `source_bom_master_id` is the
    // right answer when it is set — it is what the row's BOM column shows — but
    // it is NULL on every line that actually has child plans today (checked on
    // both databases), because the BOM planning modal does not write it back.
    // So fall back to the BOM those plans were raised on, or the panel would
    // never appear at all.
    const childPlanBomByLine = new Map<string, string>();
    for (const lr of lineRows) {
      const fromPlans = planBomByLine.get(lr.line.id);
      if (!fromPlans) continue;
      const onLine = lr.line.sourceBomMasterId;
      childPlanBomByLine.set(lr.line.id, onLine && UUID_RE.test(onLine) ? onLine : fromPlans);
    }
    const childPlanBomIds = [...new Set(childPlanBomByLine.values())];
    // Joined to `items` the same way ADR-107's cap and the BOM modal do, so
    // `childItemCode` is the same string the plan's `bom_child_code` holds.
    const childBomLineRows =
      childPlanBomIds.length === 0
        ? []
        : await tx
            .select({
              bomMasterId: bomMasterLines.bomMasterId,
              childCode: items.code,
              childName: items.name,
              qtyPerSet: bomMasterLines.qtyPerSet,
            })
            .from(bomMasterLines)
            .innerJoin(items, eq(items.id, bomMasterLines.childItemId))
            .where(
              and(
                inArray(bomMasterLines.bomMasterId, childPlanBomIds),
                isNull(bomMasterLines.deletedAt),
              ),
            )
            .orderBy(asc(bomMasterLines.lineNo));
    const childBomLinesByBom = new Map<
      string,
      Array<{ code: string; name: string | null; qtyPerSet: number }>
    >();
    for (const b of childBomLineRows) {
      const bucket = childBomLinesByBom.get(b.bomMasterId) ?? [];
      bucket.push({ code: b.childCode, name: b.childName ?? null, qtyPerSet: Number(b.qtyPerSet) });
      childBomLinesByBom.set(b.bomMasterId, bucket);
    }

    const bomChildrenByLine = new Map<string, PlanningLine['bomChildren']>();
    for (const lr of lineRows) {
      const bomId = childPlanBomByLine.get(lr.line.id);
      if (!bomId) continue;
      const bomLines = childBomLinesByBom.get(bomId);
      // The BOM's parts are gone (edited or deleted after the plans were
      // raised): report nothing rather than invent a requirement — the same
      // fall-through ADR-107's cap takes.
      if (!bomLines || bomLines.length === 0) continue;
      // A line closed short will never be made, so its parts are not owed and
      // must not be painted as outstanding (ADR-196).
      if (lr.line.shortClosedAt !== null) continue;
      const lineOrderQty = lr.line.orderQty;
      bomChildrenByLine.set(
        lr.line.id,
        bomLines.map((b) => ({
          childItemCode: b.code,
          childItemName: b.name,
          qtyPerSet: b.qtyPerSet,
          // ADR-107's own requirement formula, to the letter, so this panel and
          // the server's create-time cap state the same requirement.
          requiredQty: Math.ceil(b.qtyPerSet * lineOrderQty),
          plannedQty: childPlannedByKey.get(`${lr.line.id}|${b.code}`) ?? 0,
        })),
      );
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

    // 7a. ADR-221 — the header Equipment BOM's parts, for the complete-sets
    // count of THE equipment line's Plan Qty. Same join as childBomLineRows
    // above / ADR-107's cap / lib/so-line-coverage soLineEquipmentSetsRaw, so
    // the screen and every SQL reader count the same sets. Every BOM line is
    // passed: soLinePlanCoverage itself skips qty_per_set <= 0 and sums a
    // part that sits on two BOM lines.
    // THE equipment line is the one whose item is the live header BOM's
    // parent (the machine); a spare-part line on the same SO is ordinary
    // (soLineIsEquipmentLineRaw is the SQL twin).
    const equipParentRows =
      equipBomId === null
        ? []
        : await tx
            .select({ parentItemId: bomMasters.parentItemId })
            .from(bomMasters)
            .where(and(eq(bomMasters.id, equipBomId), isNull(bomMasters.deletedAt)))
            .limit(1);
    const equipParentItemId = equipParentRows[0]?.parentItemId ?? null;
    const equipBomLines =
      equipBomId === null
        ? []
        : (
            await tx
              .select({ code: items.code, qtyPerSet: bomMasterLines.qtyPerSet })
              .from(bomMasterLines)
              .innerJoin(items, eq(items.id, bomMasterLines.childItemId))
              .where(
                and(eq(bomMasterLines.bomMasterId, equipBomId), isNull(bomMasterLines.deletedAt)),
              )
          ).map((b) => ({ code: b.code, qtyPerSet: Number(b.qtyPerSet) }));
    // The plan summary carries bom_child_code but not bom_master_id, which
    // the part-plan test (ADR-107 / ADR-221) needs too.
    const planBomMasterById = new Map(planRows.map((r) => [r.plan.id, r.plan.bomMasterId]));

    // 7b. Job Cards created directly against these SO lines WITHOUT a plan.
    const directJcByLine = await loadDirectJcsByLine(
      tx,
      lineRows.map((r) => r.line),
      'so',
    );

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
      const hasEquipmentBom = isEquipmentSo && equipBomId !== null;
      const isEquipmentLine =
        hasEquipmentBom && equipParentItemId !== null && r.line.itemId === equipParentItemId;
      // ADR-221 — ONE rule (packages/shared soLinePlanCoverage, mirrored in SQL
      // by lib/so-line-coverage): BOM PART plans never add into the line. An
      // equipment line counts COMPLETE SETS of its parts (the weakest part
      // decides) or its own plans, whichever is larger; every other line,
      // assembly included, counts its own plans only. Replaces ADR-216's
      // plain sum, which read IN-SO-00793 (order 10, parts 10 + 10) as 20.
      // ADR-171: on a BUY line the PRs are the plan — their live qty counts as
      // planned. On a make line they are reported but change no number.
      const totalPlanned = soLinePlanCoverage({
        isEquipmentLine,
        orderQty: r.line.orderQty,
        plans: linePlans.map((p) => ({
          planQty: p.planQty,
          bomMasterId: planBomMasterById.get(p.id) ?? null,
          bomChildCode: p.bomChildCode,
        })),
        bomLines: isEquipmentLine ? equipBomLines : [],
        buyPrQty: itemProcurementType === 'buy' ? linePrs.prQty : 0,
      }).planned;
      const orderQty = r.line.orderQty;
      const direct = directJcByLine.get(r.line.id);
      const directJcQty = direct?.qty ?? 0;
      const directJcCodes = direct?.codes ?? [];
      const coveredQty = totalPlanned + directJcQty;
      // ADR-196 — a line closed short (SO "Close") wants nothing more made or
      // bought: nothing left to plan, and it reads fully planned.
      const shortClosed = r.line.shortClosedAt !== null;
      const remaining = shortClosed ? 0 : Math.max(0, orderQty - coveredQty);
      const position = r.line.itemId ? positionByItem.get(r.line.itemId) : undefined;
      const physicalQty = Math.max(0, position?.physicalQty ?? 0);
      const totalReservedQty = Math.max(0, position?.reservedQty ?? 0);
      const availableQty = Math.max(0, position?.availableQty ?? 0);
      const reservedQty = reservedByLine.get(r.line.id) ?? 0;
      const dispatchedQty = Math.max(0, Number(r.line.dispatchedQty ?? 0));
      // What still has to be made or bought. Stock already booked to THIS line
      // covers part of the order, so planning it again would double-count it.
      const balanceToPlan = shortClosed ? 0 : Math.max(0, orderQty - dispatchedQty - reservedQty);

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
        itemRevisionId: r.drawingRev ? r.line.itemRevisionId : null,
        drawingRev: r.drawingRev ?? null,
        lineNo: r.line.lineNo,
        clientPoLineNo: r.line.clientPoLineNo,
        // ADR-261 Created On — the SO line's own created_at.
        createdAt: r.line.createdAt.toISOString(),
        createdByName: r.createdByName ?? null,
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
        // ADR-216 — what each part of this line's BOM needs and what is
        // planned for it. Empty on an ordinary line, which has no parts.
        bomChildren: bomChildrenByLine.get(r.line.id) ?? [],
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
        shortClosed,
        // ADR-196: a short-closed line reads fully planned and stops nagging.
        // The rule checks it first, so a draft plan left on the line cannot
        // drag it back to "partial".
        lineStatus: toPlanningLineStatus(
          planningLineStatus({
            orderQty,
            remaining,
            totalPlanned,
            directJcQty,
            plans: linePlans,
            shortClosed,
          }).state,
        ),
        hasEquipmentBom,
        hasAssemblyBom,
        bomMasterId: activeBomId,
        bomNo: activeBomNo,
        bomPartsCount: activeBomParts,
        // ADR-279 — a Party GRN is only ever on a JWSO line.
        partyGrnStatus: 'none',
      };
    });

    return {
      soId: so.id,
      soCode: so.code,
      soInternalNo: so.internalSoNo ?? null,
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
      customerName: liveJwCustomerName(),
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
      // ADR-261 rev — Created By: who entered the JWSO line (same row as Created On).
      createdByName: createdByNameSql(jobWorkOrderLines.createdBy),
      itemCode: items.code,
      itemName: items.name,
      itemProcurementType: items.procurementType,
      // Item + Drawing Rev register (ABC/1) — the line's own Rev.
      drawingRev: itemRevisions.rev,
    })
    .from(jobWorkOrderLines)
    .leftJoin(items, and(eq(items.id, jobWorkOrderLines.itemId), isNull(items.deletedAt)))
    .leftJoin(
      itemRevisions,
      and(eq(itemRevisions.id, jobWorkOrderLines.itemRevisionId), isNull(itemRevisions.deletedAt)),
    )
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

  // 3-5. Plans + linked JC code + PR codes, ops counts, bucketed by line (plans.jw_line_id).
  const { plansByLine } = await loadPlanSummariesByLine(tx, lineIds, 'jw');

  // 6. Direct (plan-less) Job Cards against these JW lines.
  const directJcByLine = await loadDirectJcsByLine(
    tx,
    lineRows.map((r) => r.line),
    'jw',
  );

  // 6b. PHYSICAL / RESERVED / AVAILABLE per line item — see the SO branch (7c).
  const lineItemIds = [
    ...new Set(lineRows.map((r) => r.line.itemId).filter((id): id is string => id !== null)),
  ];
  const positionByItem = await readStockPositions(tx, companyId, lineItemIds);

  // 6c. Reserved to each line (a JW line books against the same column).
  const reservedByLine = await readReservedByLine(tx, companyId, lineIds);

  // 6d. ADR-279 — the same Customer RM read and rule as the first Planning list.
  const grnStatusByLine = await partyGrnStatusByLine(tx, companyId, [jwId]);

  // 7. Compose lines. JW lines have no BOM master → BOM branches always off.
  const lines: PlanningLine[] = lineRows.map((r) => {
    const linePlans = plansByLine.get(r.line.id) ?? [];
    const totalPlanned = linePlans.reduce((s, p) => s + p.planQty, 0);
    const orderQty = r.line.orderQty;
    const direct = directJcByLine.get(r.line.id);
    const directJcQty = direct?.qty ?? 0;
    const directJcCodes = direct?.codes ?? [];
    const coveredQty = totalPlanned + directJcQty;
    // ADR-268 — a JW line closed short (ADR-194) wants nothing more made, same
    // as an SO line (ADR-196): nothing left to plan, and it reads fully planned.
    const shortClosed = r.line.shortClosedAt !== null;
    const remaining = shortClosed ? 0 : Math.max(0, orderQty - coveredQty);
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
    const balanceToPlan = shortClosed ? 0 : Math.max(0, orderQty - dispatchedQty - reservedQty);

    return {
      soLineId: r.line.id,
      partyGrnStatus: grnStatusByLine.get(r.line.id) ?? 'none',
      itemRevisionId: r.drawingRev ? r.line.itemRevisionId : null,
      drawingRev: r.drawingRev ?? null,
      lineNo: r.line.lineNo,
      // ADR-236: the JW line carries the customer's PO line no. too.
      clientPoLineNo: r.line.clientPoLineNo ?? null,
      // ADR-261 Created On — the JWSO line's own created_at.
      createdAt: r.line.createdAt.toISOString(),
      createdByName: r.createdByName ?? null,
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
      // ADR-216 — a job-work line is never planned through a BOM: the BOM
      // planning modal reads sales_order_lines only (getPlanningBom), and this
      // branch reports `bomMasterId: null` so the screen never offers the
      // button. ADR-107's child cap is likewise SO-line only, so the server
      // would not even recognise a job-work child plan. Always empty here.
      bomChildren: [],
      remaining,
      stockQty: availableQty,
      reservedQty,
      physicalQty,
      totalReservedQty,
      dispatchedQty,
      availableQty,
      balanceToPlan,
      shortClosed,
      lineStatus: toPlanningLineStatus(
        planningLineStatus({
          orderQty,
          remaining,
          totalPlanned,
          directJcQty,
          plans: linePlans,
          shortClosed,
        }).state,
      ),
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
        soInternalNo: salesOrders.internalSoNo,
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
        soInternalNo: row.soInternalNo ?? null,
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
        // ADR-216 — the child part this plan is for (same aliased join as the
        // detail pane; `items` is the BOM child join in step 3 above).
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
      .leftJoin(sql`${items} as plan_item`, PLAN_ITEM_JOIN_ON)
      .leftJoin(sql`${routeCards} as plan_rc`, PLAN_RC_JOIN_ON)
      .where(
        and(
          eq(plans.soLineId, soLineId),
          isNull(plans.deletedAt),
          sql`${plans.planStatus} <> 'cancelled'`,
        ),
      );
    const posByPlan = await loadProductionOrdersByPlan(
      tx,
      existing.map((r) => r.plan.id),
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
        productionOrders: posByPlan.get(r.plan.id) ?? [],
        ...planItemFields(r),
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
      soInternalNo: row.soInternalNo ?? null,
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

      // ADR-196 — a line closed short wants nothing more bought.
      if (row.line.shortClosedAt !== null) {
        throw new ValidationError(
          `SO ${row.soCode} Ln ${row.line.lineNo} was closed short — no PR can be raised on it.`,
        );
      }

      // 3a. Lock the SO line before measuring what is left — the same row lock
      //     + Plan (plans/service.ts) and the SO edit take. Two planners (or two
      //     tabs) raising on one line now queue here; the second one measures
      //     after the first PR has committed and is refused if it would over-raise.
      //     A separate statement on purpose: under READ COMMITTED the next
      //     SELECT takes a fresh snapshot, so it sees the PR the winner inserted.
      //     FOR UPDATE returns the latest committed row, so its short-close
      //     stamp names the reason if the line changed while we waited.
      const lockRows = (await tx.execute(sql`
        SELECT (sol.short_closed_at IS NOT NULL) AS short_closed
        FROM public.sales_order_lines sol
        WHERE sol.id = ${soLineId}::uuid
        FOR UPDATE OF sol
      `)) as unknown as Array<{ short_closed: boolean }>;

      // 3. What the line still has left to plan — ADR-185: read off the ONE
      //    shared rule (lib/so-line-coverage.ts), the same figure the Planning
      //    line and the Needs Planning table state, never rebuilt by hand here.
      //    ADR-221: the FULL covered figure (a Buy equipment line's complete
      //    sets included), so a PR cannot be raised on top of planned parts.
      //    + Plan's own-plan cap uses the own-covered form instead.
      const leftRows = (await tx.execute(sql`
        SELECT GREATEST(sol.order_qty - ${sql.raw(soLineCoveredRaw('sol'))}, 0)::numeric AS to_plan
        FROM public.sales_order_lines sol
        WHERE sol.id = ${soLineId}::uuid
          AND sol.deleted_at IS NULL
          AND sol.short_closed_at IS NULL
      `)) as unknown as Array<{ to_plan: number }>;
      // No row = the line was deleted or closed short after the first read
      // (another user, while this request waited on the lock).
      const left = leftRows[0];
      if (!left) {
        if (lockRows[0]?.short_closed) {
          throw new ValidationError(
            `SO ${row.soCode} Ln ${row.line.lineNo} was closed short — no PR can be raised on it.`,
          );
        }
        throw new NotFoundError('Sales Order line not found. Refresh the page.');
      }
      const remaining = Number(left.to_plan ?? 0);
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
          action: ActivityAction.Create,
          entity: 'PurchaseRequest',
          entityId: pr.id,
          refId: pr.code,
          qty: input.qty,
          detail: `${pr.code} — ${row.itemName ?? itemCode} x ${input.qty} (from Planning, SO ${row.soCode} Ln ${row.line.lineNo})`,
        },
        companyId,
        user,
      );

      return { prId: pr.id, prCode: pr.code };
    }),
  );
}
