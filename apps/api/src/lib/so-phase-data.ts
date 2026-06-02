// SO phase-data engine — shared by the SO Cycle Time and Stuck Activity
// reports. Mirror of legacy _soPhaseData (L17870): per SO it derives a set of
// phase-transition timestamps and the whole-day gaps between them.
//
// Legacy collection → our table mapping (see docs/PARITY/reports-cross-cutting.md):
//   designTracker→design_tracker, plans→plans(so_line_id), jobCards→job_cards
//   (source_so_line_id), purchaseRequests→purchase_requests(source_so_line_id),
//   grn→goods_receipt_notes (PO-linked), opEntries→op_log (log_type),
//   assemblyUnits→assembly_units, dispatchLog→assembly_units.dispatch_date
//   (fallback SO status), invoices→invoices.
//
// The pure compute helpers (computeDurations / diffDays) are exported for unit
// tests; the SQL loader mirrors the raw-SQL style of sc-dashboard/service.ts.

import type { SoDurations, SoPhaseTimestamps } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../db/with-user-context';

export interface SoPhaseData {
  soId: string;
  soNo: string;
  customer: string | null;
  type: string | null;
  status: string;
  orderQty: number;
  dueDate: string | null;
  phases: SoPhaseTimestamps;
  durations: SoDurations;
}

/** Whole days between two date/timestamp strings; null if either is missing. */
export function diffDays(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const d1 = new Date(a.substring(0, 10));
  const d2 = new Date(b.substring(0, 10));
  const t1 = d1.getTime();
  const t2 = d2.getTime();
  if (Number.isNaN(t1) || Number.isNaN(t2)) return null;
  return Math.round((t2 - t1) / (1000 * 60 * 60 * 24));
}

/** Derive all phase durations from a set of phase timestamps (legacy L17980). */
export function computeDurations(p: SoPhaseTimestamps): SoDurations {
  return {
    design: diffDays(p.designAssigned, p.designApproved),
    designToPlan: diffDays(p.designApproved ?? p.bomLinked, p.planCreated),
    planToJc: diffDays(p.planCreated, p.jcCreated),
    materialProc: diffDays(p.prRaised, p.grnReceived),
    production: diffDays(p.firstOpStart, p.lastOpEnd),
    qc: diffDays(p.firstQcStart, p.lastQcEnd),
    assembly: diffDays(p.assemblyStarted, p.assemblyDone),
    assemblyToDispatch: diffDays(p.assemblyDone, p.dispatched),
    total: diffDays(p.soCreated, p.dispatched ?? p.invoiced),
  };
}

type PhaseRow = {
  so_id: string;
  so_no: string;
  customer: string | null;
  type: string | null;
  status: string;
  order_qty: string | number;
  due_date: string | null;
  so_created: string | null;
  design_assigned: string | null;
  design_approved: string | null;
  bom_linked: string | null;
  plan_created: string | null;
  jc_created: string | null;
  pr_raised: string | null;
  grn_received: string | null;
  first_op_start: string | null;
  last_op_end: string | null;
  first_qc_start: string | null;
  last_qc_end: string | null;
  assembly_started: string | null;
  assembly_done: string | null;
  dispatched: string | null;
  invoiced: string | null;
};

const toStr = (v: string | null): string | null =>
  v == null ? null : typeof v === 'string' ? v : String(v);

/**
 * Load phase data for every non-deleted SO in the company. One round-trip;
 * correlated subqueries per phase (SO counts are in the hundreds at our scale).
 * Must run inside a withUserContext transaction (RLS-scoped).
 */
export async function loadSoPhaseData(
  tx: DbTransaction,
  companyId: string,
): Promise<SoPhaseData[]> {
  const cid = `'${companyId}'::uuid`;
  const res = await tx.execute(
    sql.raw(`
      SELECT
        so.id AS so_id,
        so.code AS so_no,
        COALESCE(cl.name, so.customer_name) AS customer,
        so.type::text AS type,
        so.status::text AS status,
        (SELECT COALESCE(SUM(sol.order_qty), 0) FROM sales_order_lines sol
           WHERE sol.sales_order_id = so.id AND sol.deleted_at IS NULL) AS order_qty,
        (SELECT MIN(sol.due_date) FROM sales_order_lines sol
           WHERE sol.sales_order_id = so.id AND sol.deleted_at IS NULL) AS due_date,
        so.so_date AS so_created,
        (SELECT MIN(dt.start_date) FROM design_tracker dt
           WHERE dt.sales_order_id = so.id AND dt.deleted_at IS NULL) AS design_assigned,
        (SELECT MIN(dt.approved_at) FROM design_tracker dt
           WHERE dt.sales_order_id = so.id AND dt.deleted_at IS NULL
             AND dt.status = 'Approved') AS design_approved,
        (SELECT b.created_at FROM bom_masters b
           WHERE so.bom_master_id ~ '^[0-9a-fA-F-]{36}$'
             AND b.id = so.bom_master_id::uuid AND b.deleted_at IS NULL
           LIMIT 1) AS bom_linked,
        (SELECT MIN(p.created_at) FROM plans p
           JOIN sales_order_lines sl ON sl.id = p.so_line_id
           WHERE sl.sales_order_id = so.id AND p.deleted_at IS NULL) AS plan_created,
        (SELECT MIN(jc.jc_date) FROM job_cards jc
           JOIN sales_order_lines sl ON sl.id = jc.source_so_line_id
           WHERE sl.sales_order_id = so.id AND jc.deleted_at IS NULL) AS jc_created,
        (SELECT MIN(pr.pr_date) FROM purchase_requests pr
           JOIN sales_order_lines sl ON sl.id = pr.source_so_line_id
           WHERE sl.sales_order_id = so.id AND pr.deleted_at IS NULL) AS pr_raised,
        (SELECT MAX(grn.grn_date) FROM goods_receipt_notes grn
           JOIN purchase_orders po ON po.id = grn.purchase_order_id
           JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
           JOIN sales_order_lines sl ON sl.id = pol.source_so_line_id
           WHERE sl.sales_order_id = so.id AND grn.deleted_at IS NULL) AS grn_received,
        prod.first_op_start,
        prod.last_op_end,
        prod.first_qc_start,
        prod.last_qc_end,
        (SELECT MIN(au.assembly_date) FROM assembly_units au
           WHERE au.sales_order_id = so.id AND au.deleted_at IS NULL) AS assembly_started,
        (SELECT MAX(au.assembly_date) FROM assembly_units au
           WHERE au.sales_order_id = so.id AND au.deleted_at IS NULL) AS assembly_done,
        COALESCE(
          (SELECT MAX(au.dispatch_date)::text FROM assembly_units au
             WHERE au.sales_order_id = so.id AND au.dispatched AND au.deleted_at IS NULL),
          CASE WHEN so.status IN ('dispatched', 'closed')
               THEN so.updated_at::date::text ELSE NULL END
        ) AS dispatched,
        (SELECT MAX(inv.invoice_date) FROM invoices inv
           WHERE inv.sales_order_id = so.id AND inv.deleted_at IS NULL) AS invoiced
      FROM sales_orders so
      LEFT JOIN clients cl ON cl.id = so.client_id
      LEFT JOIN LATERAL (
        SELECT
          MIN(ol.log_date) FILTER (WHERE ol.log_type IN ('start', 'complete')) AS first_op_start,
          MAX(ol.log_date) FILTER (WHERE ol.log_type IN ('start', 'complete')) AS last_op_end,
          MIN(ol.log_date) FILTER (WHERE ol.log_type = 'qc') AS first_qc_start,
          MAX(ol.log_date) FILTER (WHERE ol.log_type = 'qc') AS last_qc_end
        FROM op_log ol
        JOIN jc_ops o ON o.id = ol.jc_op_id
        JOIN job_cards jc ON jc.id = o.job_card_id
        JOIN sales_order_lines sl ON sl.id = jc.source_so_line_id
        WHERE sl.sales_order_id = so.id
      ) prod ON TRUE
      WHERE so.company_id = ${cid} AND so.deleted_at IS NULL
      ORDER BY so.code DESC
    `),
  );

  return (res as unknown as PhaseRow[]).map((r) => {
    const phases: SoPhaseTimestamps = {
      soCreated: toStr(r.so_created),
      designAssigned: toStr(r.design_assigned),
      designApproved: toStr(r.design_approved),
      bomLinked: toStr(r.bom_linked),
      planCreated: toStr(r.plan_created),
      jcCreated: toStr(r.jc_created),
      prRaised: toStr(r.pr_raised),
      grnReceived: toStr(r.grn_received),
      firstOpStart: toStr(r.first_op_start),
      lastOpEnd: toStr(r.last_op_end),
      firstQcStart: toStr(r.first_qc_start),
      lastQcEnd: toStr(r.last_qc_end),
      assemblyStarted: toStr(r.assembly_started),
      assemblyDone: toStr(r.assembly_done),
      dispatched: toStr(r.dispatched),
      invoiced: toStr(r.invoiced),
    };
    return {
      soId: r.so_id,
      soNo: r.so_no,
      customer: r.customer,
      type: r.type,
      status: r.status,
      orderQty: Number(r.order_qty) || 0,
      dueDate: toStr(r.due_date),
      phases,
      durations: computeDurations(phases),
    };
  });
}
