// SO Planning workflow service (PL-4b).
//
// Two read endpoints powering the legacy /planning two-pane workflow:
//
//   GET /so-planning              → left pane SO list with planning %
//   GET /so-planning/:soId        → right pane lines + plans + BOM flags
//   GET /so-planning/:soId/bom/:lineId → §8 + §9 BOM explosion + child plans
//
// Math + grouping mirror legacy renderSOPlanning (HTML L9299) +
// showEquipBOMPlanning (L8848) + showBOMPlanning (L7116). All reads,
// no writes. Writes go through the existing plans/service.ts.
//
// Query plan: batched. List endpoint = 2 round-trips. Detail = 3.
// BOM endpoint = 5.

import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type {
  PlanningBomChild,
  PlanningBomResponse,
  PlanningDetailResponse,
  PlanningLine,
  PlanningPlanSummary,
  PlanningSoListResponse,
} from '@innovic/shared';
import {
  bomMasterLines,
  bomMasters,
  items,
  itemStockBalances,
  jobCards,
  planOps,
  plans,
  purchaseRequests,
  salesOrderLines,
  salesOrders,
} from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError, ValidationError } from '../../lib/errors';

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

// ─── Left pane ───────────────────────────────────────────────────────────

export async function getPlanningSoList(user: AuthContext): Promise<PlanningSoListResponse> {
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // 1. Open SO headers + per-line totals (aggregated in SQL).
    const soRows = await tx
      .select({
        soId: salesOrders.id,
        soCode: salesOrders.code,
        customerName: salesOrders.customerName,
        soType: salesOrders.type,
        totalLines: sql<number>`count(${salesOrderLines.id})::int`.as('total_lines'),
        totalQty: sql<number>`coalesce(sum(${salesOrderLines.orderQty}), 0)::int`.as('total_qty'),
        maxDueDate: sql<string | null>`max(${salesOrderLines.dueDate})::text`.as('max_due'),
      })
      .from(salesOrders)
      .leftJoin(
        salesOrderLines,
        and(
          eq(salesOrderLines.salesOrderId, salesOrders.id),
          isNull(salesOrderLines.deletedAt),
          eq(salesOrderLines.status, 'open'),
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

    if (soRows.length === 0) {
      return { generatedAt: new Date().toISOString(), items: [] };
    }

    const soIds = soRows.map((r) => r.soId);

    // 2. Planned-qty rollup per SO via the plans table.
    const plannedAgg = await tx
      .select({
        soId: salesOrders.id,
        plannedQty:
          sql<number>`coalesce(sum(${plans.planQty}), 0)::int`.as('planned_qty'),
      })
      .from(plans)
      .innerJoin(salesOrderLines, eq(salesOrderLines.id, plans.soLineId))
      .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
      .where(
        and(
          inArray(salesOrders.id, soIds),
          isNull(plans.deletedAt),
          sql`${plans.planStatus} <> 'cancelled'`,
        ),
      )
      .groupBy(salesOrders.id);

    const plannedMap = new Map<string, number>();
    for (const r of plannedAgg) plannedMap.set(r.soId, Number(r.plannedQty));

    // 2b. Direct (plan-less) Job Card qty per SO — JCs on open SO lines not
    // linked to any non-cancelled plan. Folded into coverage so the dot/pct
    // reflect production that bypassed planning (matches SO Status Review).
    const directAgg = await tx
      .select({
        soId: salesOrders.id,
        directQty: sql<number>`coalesce(sum(${jobCards.orderQty}), 0)::int`.as('direct_qty'),
      })
      .from(jobCards)
      .innerJoin(salesOrderLines, eq(salesOrderLines.id, jobCards.sourceSoLineId))
      .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
      .leftJoin(
        plans,
        and(
          eq(plans.jcId, jobCards.id),
          isNull(plans.deletedAt),
          sql`${plans.planStatus} <> 'cancelled'`,
        ),
      )
      .where(
        and(inArray(salesOrders.id, soIds), isNull(jobCards.deletedAt), isNull(plans.id)),
      )
      .groupBy(salesOrders.id);
    const directMap = new Map<string, number>();
    for (const r of directAgg) directMap.set(r.soId, Number(r.directQty));

    return {
      generatedAt: new Date().toISOString(),
      items: soRows.map((r) => {
        const totalQty = Number(r.totalQty);
        const plannedQty = plannedMap.get(r.soId) ?? 0;
        const coveredQty = plannedQty + (directMap.get(r.soId) ?? 0);
        const pct = totalQty > 0 ? Math.min(100, Math.round((coveredQty / totalQty) * 100)) : 0;
        return {
          soId: r.soId,
          soCode: r.soCode,
          customerName: r.customerName ?? null,
          soType: r.soType,
          dueDate: r.maxDueDate ?? null,
          totalLines: Number(r.totalLines),
          totalQty,
          totalPlannedQty: plannedQty,
          planningPct: pct,
          planningStatus: classifyPlanningPct(pct),
        };
      }),
    };
  });
}

// ─── Right pane ──────────────────────────────────────────────────────────

export async function getPlanningSoDetail(
  soId: string,
  user: AuthContext,
): Promise<PlanningDetailResponse> {
  if (!UUID_RE.test(soId)) throw new ValidationError(`Invalid SO id: ${soId}`);
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
    if (!so) throw new NotFoundError(`Sales order ${soId} not found`);

    // 2. Lines + items (in 1 query).
    const lineRows = await tx
      .select({
        line: salesOrderLines,
        itemCode: items.code,
        itemName: items.name,
        itemType: items.itemType,
      })
      .from(salesOrderLines)
      .leftJoin(items, and(eq(items.id, salesOrderLines.itemId), isNull(items.deletedAt)))
      .where(and(eq(salesOrderLines.salesOrderId, soId), isNull(salesOrderLines.deletedAt)))
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
        planQty: r.plan.planQty,
        opsCount: ops.count,
        hasOutsourceOp: ops.hasOutsource,
        jcCode: r.jcCode ?? null,
        dpPrCode: r.dpPrCode ?? null,
        foPrCode: r.foPrCode ?? null,
        foMatPrCode: r.foMatPrCode ?? null,
        foVendorCodeText: r.plan.foVendorCodeText,
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
              and(
                inArray(bomMasterLines.bomMasterId, allBomIds),
                isNull(bomMasterLines.deletedAt),
              ),
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
              orderQty: jobCards.orderQty,
            })
            .from(jobCards)
            .where(and(inArray(jobCards.sourceSoLineId, lineIds), isNull(jobCards.deletedAt)))
            .orderBy(asc(jobCards.code));
    const directJcByLine = new Map<string, { qty: number; codes: string[] }>();
    for (const jc of jcRows) {
      if (!jc.soLineId || linkedJcIds.has(jc.id)) continue;
      const entry = directJcByLine.get(jc.soLineId) ?? { qty: 0, codes: [] };
      entry.qty += jc.orderQty;
      entry.codes.push(jc.code);
      directJcByLine.set(jc.soLineId, entry);
    }

    // 8. Compose lines.
    const lines: PlanningLine[] = lineRows.map((r) => {
      const linePlans = plansByLine.get(r.line.id) ?? [];
      const totalPlanned = linePlans.reduce((s, p) => s + p.planQty, 0);
      const orderQty = r.line.orderQty;
      const direct = directJcByLine.get(r.line.id);
      const directJcQty = direct?.qty ?? 0;
      const directJcCodes = direct?.codes ?? [];
      const coveredQty = totalPlanned + directJcQty;
      const remaining = Math.max(0, orderQty - coveredQty);
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
        itemName: r.itemName ?? r.line.partName,
        orderQty,
        dueDate: r.line.dueDate,
        plans: linePlans,
        totalPlanned,
        directJcQty,
        directJcCodes,
        remaining,
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

// ─── BOM-planning aggregator (§8 + §9) ───────────────────────────────────

export async function getPlanningBom(
  soLineId: string,
  user: AuthContext,
): Promise<PlanningBomResponse> {
  if (!UUID_RE.test(soLineId)) throw new ValidationError(`Invalid SO line id: ${soLineId}`);
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
    if (!row) throw new NotFoundError(`Sales order line ${soLineId} not found`);

    // Resolve which BOM to use: Equipment SO uses parent SO's bomMasterId;
    // otherwise the line's sourceBomMasterId.
    const isEquipment = row.soType === 'equipment';
    const bomId =
      isEquipment && row.soBomMasterId && UUID_RE.test(row.soBomMasterId)
        ? row.soBomMasterId
        : row.line.sourceBomMasterId;
    if (!bomId) {
      throw new ValidationError(
        `SO line ${soLineId} has no linked BOM master (neither parent Equipment BOM nor line sourceBomMasterId)`,
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
        and(eq(bomMasters.id, bomId), eq(bomMasters.companyId, companyId), isNull(bomMasters.deletedAt)),
      )
      .limit(1);
    const bom = bomHeaders[0];
    if (!bom) throw new NotFoundError(`BOM master ${bomId} not found`);

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
        planQty: r.plan.planQty,
        opsCount: 0,
        hasOutsourceOp: false,
        jcCode: r.jcCode ?? null,
        dpPrCode: null,
        foPrCode: null,
        foMatPrCode: null,
        foVendorCodeText: null,
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
      parentItemName: row.itemName ?? row.line.partName,
      orderQty,
      supportsAssemblyPlan: !isEquipment && row.itemType === 'assembly',
      hasAssemblyPlan,
      children,
    };
  });
}
