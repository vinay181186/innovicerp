// Production Dashboard service (Production Wave 4) — read-only.
//
// GET /production-dashboard — mirrors legacy renderDashboard (HTML L3658):
// production counters + open job cards + ready-to-process ops. Computed via
// raw SQL over v_jc_status + v_jc_op_status (no migration). RLS via base tables.

import { sql } from 'drizzle-orm';
import type {
  ProductionDashboardCounters,
  ProductionDashboardJc,
  ProductionDashboardLowStockItem,
  ProductionDashboardReadyOp,
  ProductionDashboardResponse,
  ProductionDashboardSupplyChain,
} from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

export async function getProductionDashboard(
  user: AuthContext,
): Promise<ProductionDashboardResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // ── Op-level counters (enrichedOps in legacy) ──────────────────────────
    const opCountRows = await tx.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN op_type <> 'outsource' AND computed_status <> 'complete'
                          THEN GREATEST(available, 0) ELSE 0 END), 0)::int AS "pendingQty",
        COUNT(*) FILTER (
          WHERE op_type <> 'outsource' AND (available > 0 OR computed_status = 'in_progress')
        )::int AS "readyOps",
        COALESCE(SUM(CASE WHEN op_type <> 'outsource'
                           AND (available > 0 OR computed_status = 'in_progress')
                          THEN available ELSE 0 END), 0)::int AS "readyQty",
        COUNT(*) FILTER (WHERE op_type = 'outsource' AND computed_status <> 'complete')::int
          AS "outsourceOps",
        COUNT(*) FILTER (WHERE op_type = 'outsource'
                          AND computed_status IN ('at_vendor', 'po_created'))::int AS "atVendor",
        COUNT(*) FILTER (WHERE computed_status = 'running')::int AS "runningOps"
      FROM public.v_jc_op_status
      WHERE company_id = ${companyId}::uuid
    `);
    const oc = (opCountRows as unknown as Array<Record<string, unknown>>)[0] ?? {};

    // ── JC-level counters (jcStatus in legacy) ─────────────────────────────
    const jcCountRows = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE computed_status = 'open')::int   AS "openJc",
        COUNT(*)::int                                            AS "totalJc",
        COUNT(*) FILTER (WHERE computed_status = 'no_ops')::int AS "noOpsJc"
      FROM public.v_jc_status
      WHERE company_id = ${companyId}::uuid
    `);
    const jcc = (jcCountRows as unknown as Array<Record<string, unknown>>)[0] ?? {};

    const counters: ProductionDashboardCounters = {
      openJc: Number(jcc['openJc'] ?? 0),
      totalJc: Number(jcc['totalJc'] ?? 0),
      noOpsJc: Number(jcc['noOpsJc'] ?? 0),
      runningOps: Number(oc['runningOps'] ?? 0),
      pendingQty: Number(oc['pendingQty'] ?? 0),
      readyOps: Number(oc['readyOps'] ?? 0),
      readyQty: Number(oc['readyQty'] ?? 0),
      outsourceOps: Number(oc['outsourceOps'] ?? 0),
      atVendor: Number(oc['atVendor'] ?? 0),
    };

    // ── Open job cards (compact cards) ─────────────────────────────────────
    const jcRows = await tx.execute(sql`
      SELECT
        jc.id AS "jobCardId", jc.code, i.code AS "itemCode", i.name AS "itemName",
        jc.priority, jc.order_qty AS "orderQty", jc.due_date AS "dueDate",
        s.total_ops AS "totalOps", s.done_ops AS "doneOps"
      FROM public.v_jc_status s
      JOIN public.job_cards jc ON jc.id = s.job_card_id AND jc.deleted_at IS NULL
      LEFT JOIN public.items i ON i.id = jc.item_id
      WHERE s.company_id = ${companyId}::uuid AND s.computed_status = 'open'
      ORDER BY (jc.priority = 'high') DESC, jc.due_date ASC NULLS LAST, jc.code
      LIMIT 60
    `);
    const openJobCards: ProductionDashboardJc[] = (
      jcRows as unknown as Array<Record<string, unknown>>
    ).map((r) => ({
      jobCardId: r['jobCardId'] as string,
      code: r['code'] as string,
      itemCode: (r['itemCode'] as string | null) ?? null,
      itemName: (r['itemName'] as string | null) ?? null,
      priority: r['priority'] as ProductionDashboardJc['priority'],
      orderQty: Number(r['orderQty'] ?? 0),
      doneOps: Number(r['doneOps'] ?? 0),
      totalOps: Number(r['totalOps'] ?? 0),
      dueDate: r['dueDate'] != null ? String(r['dueDate']).slice(0, 10) : null,
    }));

    // ── Ready to process now (available > 0 or in progress, non-outsource) ──
    const readyRows = await tx.execute(sql`
      SELECT
        jo.id AS "jcOpId", jc.code AS "jobCardCode", jo.op_seq AS "opSeq",
        jo.operation, m.code AS "machineCode",
        jc.order_qty AS "orderQty", vos.completed_qty AS "completedQty",
        vos.available, vos.computed_status AS "computedStatus",
        ROUND(vos.available * jo.cycle_time_min / 60.0, 2) AS "pendingHrs"
      FROM public.jc_ops jo
      JOIN public.v_jc_op_status vos ON vos.jc_op_id = jo.id
      JOIN public.job_cards jc ON jc.id = jo.job_card_id AND jc.deleted_at IS NULL
      LEFT JOIN public.machines m ON m.id = jo.machine_id
      WHERE jo.company_id = ${companyId}::uuid
        AND jo.deleted_at IS NULL
        AND jo.op_type <> 'outsource'
        AND (vos.available > 0 OR vos.computed_status = 'in_progress')
      ORDER BY jc.code, jo.op_seq
      LIMIT 100
    `);
    const readyToProcess: ProductionDashboardReadyOp[] = (
      readyRows as unknown as Array<Record<string, unknown>>
    ).map((r) => ({
      jcOpId: r['jcOpId'] as string,
      jobCardCode: r['jobCardCode'] as string,
      opSeq: Number(r['opSeq']),
      operation: (r['operation'] as string | null) ?? '',
      machineCode: (r['machineCode'] as string | null) ?? null,
      orderQty: Number(r['orderQty'] ?? 0),
      completedQty: Number(r['completedQty'] ?? 0),
      available: Number(r['available'] ?? 0),
      pendingHrs: Number(r['pendingHrs'] ?? 0),
      computedStatus: (r['computedStatus'] as string | null) ?? '',
    }));

    // ── Supply Chain Snapshot (legacy L3804-3838) ─────────────────────────
    // Additive DTO exposure of figures already computed elsewhere — nothing is
    // recomputed in a new way:
    //  · low/zero stock reuse store-inventory/service.ts's exact formula
    //    (minQty>0 && inStock<=minQty; inStock=0) over the v_item_stock view.
    //  · openPos/todayGrn reuse sc-dashboard/service.ts's predicates
    //    (status IN open|partial|qc_pending; grn_date = current_date).
    const stockCountRows = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (
          WHERE i.min_stock_qty > 0 AND COALESCE(s.on_hand_qty, 0) <= i.min_stock_qty
        )::int AS "lowStockCount",
        COUNT(*) FILTER (WHERE COALESCE(s.on_hand_qty, 0) = 0)::int AS "zeroStockCount"
      FROM public.items i
      LEFT JOIN public.v_item_stock s
        ON s.item_id = i.id AND s.company_id = i.company_id
      WHERE i.company_id = ${companyId}::uuid AND i.deleted_at IS NULL
    `);
    const scc = (stockCountRows as unknown as Array<Record<string, unknown>>)[0] ?? {};

    const lowItemRows = await tx.execute(sql`
      SELECT
        i.id AS "itemId", i.code,
        COALESCE(s.on_hand_qty, 0)::int AS "inStock",
        i.min_stock_qty AS "minQty"
      FROM public.items i
      LEFT JOIN public.v_item_stock s
        ON s.item_id = i.id AND s.company_id = i.company_id
      WHERE i.company_id = ${companyId}::uuid
        AND i.deleted_at IS NULL
        AND i.min_stock_qty > 0
        AND COALESCE(s.on_hand_qty, 0) <= i.min_stock_qty
      ORDER BY i.code
      LIMIT 50
    `);
    const lowStockItems: ProductionDashboardLowStockItem[] = (
      lowItemRows as unknown as Array<Record<string, unknown>>
    ).map((r) => ({
      itemId: r['itemId'] as string,
      code: r['code'] as string,
      inStock: Number(r['inStock'] ?? 0),
      minQty: Number(r['minQty'] ?? 0),
    }));

    const poGrnRows = await tx.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM public.purchase_orders po
           WHERE po.company_id = ${companyId}::uuid
             AND po.deleted_at IS NULL
             AND po.status IN ('open', 'partial', 'qc_pending'))::int AS "openPos",
        (SELECT COUNT(*) FROM public.goods_receipt_notes grn
           WHERE grn.company_id = ${companyId}::uuid
             AND grn.deleted_at IS NULL
             AND grn.grn_date = current_date)::int AS "todayGrn"
    `);
    const pg = (poGrnRows as unknown as Array<Record<string, unknown>>)[0] ?? {};

    const supplyChain: ProductionDashboardSupplyChain = {
      lowStockCount: Number(scc['lowStockCount'] ?? 0),
      zeroStockCount: Number(scc['zeroStockCount'] ?? 0),
      openPos: Number(pg['openPos'] ?? 0),
      todayGrn: Number(pg['todayGrn'] ?? 0),
      lowStockItems,
    };

    return { counters, openJobCards, readyToProcess, supplyChain };
  });
}
