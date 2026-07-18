// Supply Chain Dashboard service. Mirror of legacy renderSCDashboard
// (L16790). Aggregates active POs into vendor/SO summaries + complete
// PO summary with tax + pending lines + recent GRN. One round-trip.

import type { ScDashboardResponse, ScPoSummaryRow } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

export async function getScDashboard(user: AuthContext): Promise<ScDashboardResponse> {
  const companyId = requireCompany(user);
  const cid = `'${companyId}'::uuid`;

  return withUserContext(user, async (tx) => {
    // ─── Summary card counts + value totals ────────────────────────
    const summaryR = await tx.execute(
      sql.raw(`
        SELECT
          COUNT(*) FILTER (WHERE po.status = 'open')        AS open_pos,
          COUNT(*) FILTER (WHERE po.status = 'partial')     AS partial_pos,
          COUNT(*) FILTER (WHERE po.status = 'closed')      AS closed_pos,
          COUNT(*) FILTER (WHERE po.status = 'cancelled')   AS cancelled_pos,
          COALESCE(SUM(CASE WHEN po.status <> 'cancelled' THEN pol.qty * pol.rate ELSE 0 END), 0) AS total_order_val,
          COALESCE(SUM(CASE WHEN po.status <> 'cancelled' THEN pol.received_qty * pol.rate ELSE 0 END), 0) AS total_recv_val
        FROM purchase_orders po
        LEFT JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
        WHERE po.company_id = ${cid}
          AND po.deleted_at IS NULL
      `),
    );
    type SumRow = {
      open_pos: number;
      partial_pos: number;
      closed_pos: number;
      cancelled_pos: number;
      total_order_val: string | number;
      total_recv_val: string | number;
    };
    const s = (summaryR as unknown as SumRow[])[0]!;
    const totalOrderVal = Number(s.total_order_val) || 0;
    const totalRecvVal = Number(s.total_recv_val) || 0;

    const grnR = await tx.execute(
      sql.raw(`
        SELECT COUNT(*) AS c,
               COUNT(*) FILTER (WHERE grn_date = current_date) AS today_c
        FROM goods_receipt_notes
        WHERE company_id = ${cid}
          AND deleted_at IS NULL
      `),
    );
    const g = (grnR as unknown as { c: number; today_c: number }[])[0]!;

    // ─── By vendor (open / partial / qc_pending POs) ────────────────
    const vendorR = await tx.execute(
      sql.raw(`
        SELECT
          po.vendor_id,
          COALESCE(v.code, vt.code, po.vendor_code_text) AS vendor_code,
          COALESCE(v.name, vt.name, po.vendor_code_text) AS vendor_name,
          COUNT(pol.id) AS lines,
          COUNT(DISTINCT pol.item_id) AS unique_items,
          COALESCE(SUM(pol.qty), 0) AS total_qty,
          COALESCE(SUM(pol.received_qty), 0) AS received_qty,
          COALESCE(SUM(pol.qty * pol.rate), 0) AS total_val,
          COALESCE(SUM((pol.qty - pol.received_qty) * pol.rate), 0) AS pending_val
        FROM purchase_orders po
        JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
        LEFT JOIN vendors v ON v.id = po.vendor_id
        LEFT JOIN vendors vt ON vt.code = po.vendor_code_text AND vt.company_id = po.company_id AND vt.deleted_at IS NULL
        WHERE po.company_id = ${cid}
          AND po.deleted_at IS NULL
          AND po.status IN ('open', 'partial', 'qc_pending')
        GROUP BY po.vendor_id, v.code, v.name, po.vendor_code_text, vt.code, vt.name
        ORDER BY pending_val DESC
        LIMIT 50
      `),
    );
    type VRow = {
      vendor_id: string | null;
      vendor_code: string | null;
      vendor_name: string | null;
      lines: number;
      unique_items: number;
      total_qty: string | number;
      received_qty: string | number;
      total_val: string | number;
      pending_val: string | number;
    };
    const byVendor = (vendorR as unknown as VRow[]).map((r) => ({
      vendorId: r.vendor_id,
      vendorCode: r.vendor_code,
      vendorName: r.vendor_name,
      lines: Number(r.lines) || 0,
      uniqueItems: Number(r.unique_items) || 0,
      totalQty: Number(r.total_qty) || 0,
      receivedQty: Number(r.received_qty) || 0,
      totalVal: Number(r.total_val) || 0,
      pendingVal: Number(r.pending_val) || 0,
    }));

    // ─── By SO ─────────────────────────────────────────────────────
    const soR = await tx.execute(
      sql.raw(`
        SELECT
          so.id AS so_ref_id,
          so.code AS so_code,
          COUNT(pol.id) AS lines,
          COUNT(DISTINCT po.vendor_id) AS unique_vendors,
          COALESCE(SUM(pol.qty), 0) AS total_qty,
          COALESCE(SUM(pol.received_qty), 0) AS received_qty,
          COALESCE(SUM(pol.qty * pol.rate), 0) AS total_val,
          COALESCE(SUM((pol.qty - pol.received_qty) * pol.rate), 0) AS pending_val
        FROM purchase_orders po
        JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
        LEFT JOIN sales_order_lines sol ON sol.id = pol.source_so_line_id
        LEFT JOIN sales_orders so ON so.id = sol.sales_order_id
        WHERE po.company_id = ${cid}
          AND po.deleted_at IS NULL
          AND po.status IN ('open', 'partial', 'qc_pending')
        GROUP BY so.id, so.code
        ORDER BY pending_val DESC
        LIMIT 50
      `),
    );
    type SRow = {
      so_ref_id: string | null;
      so_code: string | null;
      lines: number;
      unique_vendors: number;
      total_qty: string | number;
      received_qty: string | number;
      total_val: string | number;
      pending_val: string | number;
    };
    const bySo = (soR as unknown as SRow[]).map((r) => ({
      soRefId: r.so_ref_id,
      soCode: r.so_code,
      lines: Number(r.lines) || 0,
      uniqueVendors: Number(r.unique_vendors) || 0,
      totalQty: Number(r.total_qty) || 0,
      receivedQty: Number(r.received_qty) || 0,
      totalVal: Number(r.total_val) || 0,
      pendingVal: Number(r.pending_val) || 0,
    }));

    // ─── Complete PO summary (all active POs, header+lines with tax)─
    const poSumR = await tx.execute(
      sql.raw(`
        WITH po_agg AS (
          SELECT
            po.id, po.code, po.po_date, po.status, po.vendor_id, po.vendor_code_text,
            po.sgst_pct, po.cgst_pct, po.igst_pct, po.tax_type,
            COUNT(pol.id) AS lines,
            COALESCE(SUM(pol.qty), 0) AS total_qty,
            COALESCE(SUM(pol.received_qty), 0) AS received_qty,
            COALESCE(SUM(pol.qty * pol.rate), 0) AS total_val
          FROM purchase_orders po
          LEFT JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
          WHERE po.company_id = ${cid}
            AND po.deleted_at IS NULL
            AND po.status <> 'cancelled'
          GROUP BY po.id
        ),
        grn_agg AS (
          SELECT purchase_order_id, COUNT(*)::int AS c
          FROM goods_receipt_notes
          WHERE company_id = ${cid}
            AND deleted_at IS NULL
          GROUP BY purchase_order_id
        )
        SELECT
          p.id AS po_id, p.code AS po_no, p.po_date,
          COALESCE(v.name, vt.name, p.vendor_code_text) AS vendor_name,
          COALESCE(v.code, vt.code, p.vendor_code_text) AS vendor_code,
          so.code AS so_code,
          p.lines, p.total_qty, p.received_qty, p.total_val,
          p.tax_type, p.sgst_pct, p.cgst_pct, p.igst_pct, p.status,
          COALESCE(g.c, 0) AS grn_count
        FROM po_agg p
        LEFT JOIN vendors v ON v.id = p.vendor_id
        LEFT JOIN vendors vt ON vt.code = p.vendor_code_text AND vt.company_id = ${cid} AND vt.deleted_at IS NULL
        LEFT JOIN purchase_order_lines pl0 ON pl0.purchase_order_id = p.id AND pl0.line_no = 1
        LEFT JOIN sales_order_lines sol ON sol.id = pl0.source_so_line_id
        LEFT JOIN sales_orders so ON so.id = sol.sales_order_id
        LEFT JOIN grn_agg g ON g.purchase_order_id = p.id
        ORDER BY p.po_date DESC
        LIMIT 100
      `),
    );
    type PoSumRow = {
      po_id: string;
      po_no: string;
      po_date: string;
      vendor_name: string | null;
      vendor_code: string | null;
      so_code: string | null;
      lines: number;
      total_qty: string | number;
      received_qty: string | number;
      total_val: string | number;
      tax_type: string | null;
      sgst_pct: string | number;
      cgst_pct: string | number;
      igst_pct: string | number;
      status: string;
      grn_count: number;
    };
    const poSummary: ScPoSummaryRow[] = (poSumR as unknown as PoSumRow[]).map((r) => {
      const totalVal = Number(r.total_val) || 0;
      const taxType = r.tax_type ?? 'sgst_cgst';
      const sgst = Number(r.sgst_pct) || 0;
      const cgst = Number(r.cgst_pct) || 0;
      const igst = Number(r.igst_pct) || 0;
      const taxAmount =
        taxType === 'igst'
          ? (totalVal * igst) / 100
          : (totalVal * sgst) / 100 + (totalVal * cgst) / 100;
      return {
        poId: r.po_id,
        poNo: r.po_no,
        poDate: r.po_date,
        vendorName: r.vendor_name,
        vendorCode: r.vendor_code,
        soCode: r.so_code,
        lines: Number(r.lines) || 0,
        totalQty: Number(r.total_qty) || 0,
        receivedQty: Number(r.received_qty) || 0,
        totalVal,
        taxAmount,
        grandTotal: totalVal + taxAmount,
        status: r.status,
        grnCount: Number(r.grn_count) || 0,
      };
    });

    // ─── Pending PO lines ─────────────────────────────────────────
    const pendR = await tx.execute(
      sql.raw(`
        SELECT
          po.id AS po_id, po.code AS po_no, pol.line_no, po.po_date,
          COALESCE(v.code, vt.code, po.vendor_code_text) AS vendor_code,
          COALESCE(v.name, vt.name, po.vendor_code_text) AS vendor_name,
          so.code AS so_code,
          i.code AS item_code, COALESCE(i.name, pol.item_name) AS item_name,
          pol.qty, pol.received_qty, pol.rate,
          GREATEST(0, pol.qty - pol.received_qty) AS pending_qty,
          GREATEST(0, (pol.qty - pol.received_qty) * pol.rate) AS pending_val,
          po.status
        FROM purchase_orders po
        JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
        LEFT JOIN vendors v ON v.id = po.vendor_id
        LEFT JOIN vendors vt ON vt.code = po.vendor_code_text AND vt.company_id = ${cid} AND vt.deleted_at IS NULL
        LEFT JOIN items i ON i.id = pol.item_id
        LEFT JOIN sales_order_lines sol ON sol.id = pol.source_so_line_id
        LEFT JOIN sales_orders so ON so.id = sol.sales_order_id
        WHERE po.company_id = ${cid}
          AND po.deleted_at IS NULL
          AND po.status IN ('open', 'partial', 'qc_pending')
        ORDER BY po.po_date DESC, po.code, pol.line_no
        LIMIT 200
      `),
    );
    type PendRow = {
      po_id: string;
      po_no: string;
      line_no: number;
      po_date: string;
      vendor_code: string | null;
      vendor_name: string | null;
      so_code: string | null;
      item_code: string | null;
      item_name: string | null;
      qty: string | number;
      received_qty: string | number;
      rate: string | number;
      pending_qty: string | number;
      pending_val: string | number;
      status: string;
    };
    const pendingLines = (pendR as unknown as PendRow[]).map((r) => ({
      poId: r.po_id,
      poNo: r.po_no,
      lineNo: Number(r.line_no) || 0,
      poDate: r.po_date,
      vendorCode: r.vendor_code,
      vendorName: r.vendor_name,
      soCode: r.so_code,
      itemCode: r.item_code,
      itemName: r.item_name,
      qty: Number(r.qty) || 0,
      receivedQty: Number(r.received_qty) || 0,
      pendingQty: Number(r.pending_qty) || 0,
      rate: Number(r.rate) || 0,
      pendingVal: Number(r.pending_val) || 0,
      status: r.status,
    }));

    // ─── Recent GRN (last 8) ──────────────────────────────────────
    const grnRecentR = await tx.execute(
      sql.raw(`
        SELECT grn.code AS grn_no, grn.grn_date,
               po.code AS po_no,
               COALESCE(v.code, vt.code, grn.vendor_code_text) AS vendor_code,
               COALESCE(v.name, vt.name, grn.vendor_code_text) AS vendor_name
        FROM goods_receipt_notes grn
        LEFT JOIN purchase_orders po ON po.id = grn.purchase_order_id
        LEFT JOIN vendors v ON v.id = grn.vendor_id
        LEFT JOIN vendors vt ON vt.code = grn.vendor_code_text AND vt.company_id = ${cid} AND vt.deleted_at IS NULL
        WHERE grn.company_id = ${cid}
          AND grn.deleted_at IS NULL
        ORDER BY grn.grn_date DESC, grn.created_at DESC
        LIMIT 8
      `),
    );
    type GrnRow = {
      grn_no: string;
      grn_date: string;
      po_no: string | null;
      vendor_code: string | null;
      vendor_name: string | null;
    };
    const recentGrn = (grnRecentR as unknown as GrnRow[]).map((r) => ({
      grnNo: r.grn_no,
      grnDate: r.grn_date,
      poNo: r.po_no,
      vendorCode: r.vendor_code,
      vendorName: r.vendor_name,
    }));

    return {
      summary: {
        openPos: Number(s.open_pos) || 0,
        partialPos: Number(s.partial_pos) || 0,
        closedPos: Number(s.closed_pos) || 0,
        cancelledPos: Number(s.cancelled_pos) || 0,
        totalOrderVal,
        totalRecvVal,
        pendingVal: totalOrderVal - totalRecvVal,
        grnCount: Number(g.c) || 0,
        todayGrn: Number(g.today_c) || 0,
      },
      byVendor,
      bySo,
      poSummary,
      pendingLines,
      recentGrn,
    };
  });
}
