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
  jcOps,
  jobCards,
  jobWorkOrderLines,
  jobWorkOrders,
  planOps,
  plans,
  purchaseRequests,
  salesOrderLines,
  salesOrders,
} from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
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
        maxDueDate: sql<string | null>`max(${salesOrderLines.dueDate})::text`.as('max_due'),
        // Aggregated item code + part name across this SO's lines, for the
        // client-side item search on the Planning page.
        itemsText: sql<string>`coalesce(string_agg(distinct trim(coalesce(${salesOrderLines.itemCodeText}, '') || ' ' || coalesce(${salesOrderLines.partName}, '')), ' '), '')`.as('items_text'),
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

    const soIds = soRows.map((r) => r.soId);

    // 2. Planned-qty rollup per SO via the plans table (so_line_id link).
    const plannedAgg =
      soIds.length === 0
        ? []
        : await tx
            .select({
              soId: salesOrders.id,
              plannedQty: sql<number>`coalesce(sum(${plans.planQty}), 0)::int`.as('planned_qty'),
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
    const directAgg =
      soIds.length === 0
        ? []
        : await tx
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
        itemsText: sql<string>`coalesce(string_agg(distinct trim(coalesce(${jobWorkOrderLines.itemCodeText}, '') || ' ' || coalesce(${jobWorkOrderLines.partName}, '')), ' '), '')`.as('items_text'),
      })
      .from(jobWorkOrders)
      .leftJoin(
        jobWorkOrderLines,
        and(
          eq(jobWorkOrderLines.jobWorkOrderId, jobWorkOrders.id),
          isNull(jobWorkOrderLines.deletedAt),
          eq(jobWorkOrderLines.status, 'open'),
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
              and(inArray(jobWorkOrders.id, jwIds), isNull(jobCards.deletedAt), isNull(plans.id)),
            )
            .groupBy(jobWorkOrders.id);
    const jwDirectMap = new Map<string, number>();
    for (const r of jwDirectAgg) jwDirectMap.set(r.soId, Number(r.directQty));

    const buildItem = (
      r: { soId: string; soCode: string; customerName: string | null; totalLines: number; totalQty: number; maxDueDate: string | null; itemsText: string },
      source: 'so' | 'jw',
      soType: string,
      planned: number,
      direct: number,
    ) => {
      const totalQty = Number(r.totalQty);
      const coveredQty = planned + direct;
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

    const items = [
      ...soRows.map((r) =>
        buildItem(r, 'so', r.soType, plannedMap.get(r.soId) ?? 0, directMap.get(r.soId) ?? 0),
      ),
      ...jwRows.map((r) =>
        buildItem(r, 'jw', 'job_work', jwPlannedMap.get(r.soId) ?? 0, jwDirectMap.get(r.soId) ?? 0),
      ),
    ];

    return { generatedAt: new Date().toISOString(), items };
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
    // Not an SO id → try a Job Work Order (JWs are planned identically).
    if (!so) return getJwPlanningDetail(tx, soId, companyId);

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
  if (!jw) throw new NotFoundError(`Sales order / Job Work order ${jwId} not found`);

  // 2. Lines + items.
  const lineRows = await tx
    .select({
      line: jobWorkOrderLines,
      itemCode: items.code,
      itemName: items.name,
    })
    .from(jobWorkOrderLines)
    .leftJoin(items, and(eq(items.id, jobWorkOrderLines.itemId), isNull(items.deletedAt)))
    .where(and(eq(jobWorkOrderLines.jobWorkOrderId, jwId), isNull(jobWorkOrderLines.deletedAt)))
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
            orderQty: jobCards.orderQty,
          })
          .from(jobCards)
          .where(and(inArray(jobCards.sourceJwLineId, lineIds), isNull(jobCards.deletedAt)))
          .orderBy(asc(jobCards.code));
  const directJcByLine = new Map<string, { qty: number; codes: string[] }>();
  for (const jc of jcRows) {
    if (!jc.jwLineId || linkedJcIds.has(jc.id)) continue;
    const entry = directJcByLine.get(jc.jwLineId) ?? { qty: 0, codes: [] };
    entry.qty += jc.orderQty;
    entry.codes.push(jc.code);
    directJcByLine.set(jc.jwLineId, entry);
  }

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
    const pct = orderQty > 0 ? Math.round((coveredQty / orderQty) * 100) : 0;

    return {
      soLineId: r.line.id,
      lineNo: r.line.lineNo,
      clientPoLineNo: null,
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
      parentItemName: row.itemName ?? row.line.partName,
      orderQty,
      supportsAssemblyPlan: !isEquipment && row.itemType === 'assembly',
      hasAssemblyPlan,
      children,
    };
  });
}
