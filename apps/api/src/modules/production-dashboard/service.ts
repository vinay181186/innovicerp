// Production Dashboard service (Production Wave 4) — read-only.
//
// GET /production-dashboard — mirrors legacy renderDashboard (HTML L3658):
// production counters + the Supply Chain Snapshot. The two lists (open job
// cards, ready-to-process ops) page at 25 in ./lists (ADR-201). Computed via
// raw SQL over v_jc_status + v_jc_op_status (no migration). RLS via base tables.

import { sql } from 'drizzle-orm';
import type {
  ProductionDashboardCounters,
  ProductionDashboardLowStockItem,
  ProductionDashboardResponse,
  ProductionDashboardSupplyChain,
} from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { readBelowReorder } from '../store-inventory/reorder-rule';

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

    // ── Supply Chain Snapshot (legacy L3804-3838) ─────────────────────────
    // Additive DTO exposure of figures already computed elsewhere — nothing is
    // recomputed in a new way:
    //  · "low" stock = Below Reorder, the ONE rule (store-inventory/
    //    reorder-rule.ts, ADR-193 phase 5): reorderable type, Reorder Level
    //    > 0, Available + On PO < Reorder Level. Zero = on hand 0.
    //    Field names (lowStockCount / lowStockItems / minQty) are unchanged.
    //  · openPos/todayGrn reuse sc-dashboard/service.ts's predicates
    //    (status IN open|partial|qc_pending; grn_date = current_date).
    const stockCountRows = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE COALESCE(s.on_hand_qty, 0) = 0)::int AS "zeroStockCount"
      FROM public.items i
      LEFT JOIN public.v_item_stock s
        ON s.item_id = i.id AND s.company_id = i.company_id
      WHERE i.company_id = ${companyId}::uuid AND i.deleted_at IS NULL
    `);
    const scc = (stockCountRows as unknown as Array<Record<string, unknown>>)[0] ?? {};

    const belowReorder = await readBelowReorder(tx, companyId);
    const lowStockItems: ProductionDashboardLowStockItem[] = belowReorder.slice(0, 50).map((r) => ({
      itemId: r.itemId,
      code: r.itemCode,
      inStock: r.physicalQty,
      minQty: r.reorderLevel,
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
      lowStockCount: belowReorder.length,
      zeroStockCount: Number(scc['zeroStockCount'] ?? 0),
      openPos: Number(pg['openPos'] ?? 0),
      todayGrn: Number(pg['todayGrn'] ?? 0),
      lowStockItems,
    };

    return { counters, supplyChain };
  });
}
