// Incoming QC service (QC Wave 2) — read-only.
//
// GET /incoming-qc — inspection queue for received GRN lines awaiting QC, +
// pipeline metrics + recently-completed lines. Mirrors legacy renderIncomingQC
// (HTML L23748). Raw SQL over goods_receipt_note_lines ⨝ headers ⨝ vendors ⨝
// items. RLS via base tables. The Inspect action lives on the GRN detail page
// (existing goods-receipt-notes update flow), so there is no write here.

import { sql } from 'drizzle-orm';
import type {
  IncomingQcCompletedRow,
  IncomingQcMetrics,
  IncomingQcPendingRow,
  IncomingQcResponse,
} from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function dispositionOf(accepted: number, rejected: number): IncomingQcCompletedRow['disposition'] {
  if (accepted > 0 && rejected > 0) return 'Partial Accept';
  if (rejected > 0) return 'Rejected';
  return 'Accepted';
}

export async function getIncomingQc(user: AuthContext): Promise<IncomingQcResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // ── Pending lines (received but not fully inspected) ──
    const pendingRows = await tx.execute(sql`
      SELECT
        l.id AS "grnLineId", h.id AS "grnId", h.code AS "grnNo", h.grn_date AS "grnDate",
        h.po_code_text AS "poCode",
        COALESCE(v.name, h.vendor_code_text) AS "vendorName",
        COALESCE(i.code, l.item_code_text) AS "itemCode",
        COALESCE(i.name, l.item_name) AS "itemName",
        l.received_qty AS "receivedQty",
        (l.received_qty - l.qc_accepted_qty - l.qc_rejected_qty) AS "pendingQty",
        GREATEST(0, (CURRENT_DATE - h.grn_date))::int AS "waitDays",
        COALESCE(pol.rate, 0) AS "rate"
      FROM public.goods_receipt_note_lines l
      JOIN public.goods_receipt_notes h ON h.id = l.goods_receipt_note_id AND h.deleted_at IS NULL
      LEFT JOIN public.purchase_order_lines pol ON pol.id = l.purchase_order_line_id
      LEFT JOIN public.vendors v ON v.id = h.vendor_id AND v.deleted_at IS NULL
      LEFT JOIN public.items i ON i.id = l.item_id
      WHERE l.company_id = ${companyId}::uuid
        AND l.deleted_at IS NULL
        AND l.qc_status <> 'completed'
        AND (l.received_qty - l.qc_accepted_qty - l.qc_rejected_qty) > 0
      ORDER BY h.grn_date ASC, h.code ASC
    `);
    const rawPending = pendingRows as unknown as Array<Record<string, unknown>>;
    // Value stuck in QC pipeline: Σ pendingQty × po_lines.rate (legacy L23839).
    // rate is null for manual GRN lines (no PO line) → treated as 0.
    const valueInQc = rawPending.reduce(
      (s, r) => s + Number(r['pendingQty'] ?? 0) * Number(r['rate'] ?? 0),
      0,
    );
    const pending: IncomingQcPendingRow[] = rawPending.map((r) => ({
      grnLineId: r['grnLineId'] as string,
      grnId: r['grnId'] as string,
      grnNo: r['grnNo'] as string,
      grnDate: String(r['grnDate']).slice(0, 10),
      poCode: (r['poCode'] as string | null) ?? null,
      vendorName: (r['vendorName'] as string | null) ?? null,
      itemCode: (r['itemCode'] as string | null) ?? null,
      itemName: (r['itemName'] as string | null) ?? null,
      receivedQty: Number(r['receivedQty'] ?? 0),
      pendingQty: Number(r['pendingQty'] ?? 0),
      waitDays: Number(r['waitDays'] ?? 0),
    }));

    // ── Recently completed (last 20) ──
    const completedRows = await tx.execute(sql`
      SELECT
        l.id AS "grnLineId", h.id AS "grnId", h.code AS "grnNo", h.grn_date AS "grnDate",
        l.qc_date AS "qcDate",
        CASE WHEN l.qc_date IS NOT NULL THEN (l.qc_date - h.grn_date)::int ELSE NULL END AS "respDays",
        COALESCE(v.name, h.vendor_code_text) AS "vendorName",
        COALESCE(i.code, l.item_code_text) AS "itemCode",
        COALESCE(i.name, l.item_name) AS "itemName",
        l.received_qty AS "receivedQty",
        l.qc_accepted_qty AS "acceptedQty", l.qc_rejected_qty AS "rejectedQty",
        l.qc_remarks AS "qcRemarks"
      FROM public.goods_receipt_note_lines l
      JOIN public.goods_receipt_notes h ON h.id = l.goods_receipt_note_id AND h.deleted_at IS NULL
      LEFT JOIN public.vendors v ON v.id = h.vendor_id AND v.deleted_at IS NULL
      LEFT JOIN public.items i ON i.id = l.item_id
      WHERE l.company_id = ${companyId}::uuid
        AND l.deleted_at IS NULL
        AND l.qc_status = 'completed'
      ORDER BY COALESCE(l.qc_date, h.grn_date) DESC, h.code DESC
      LIMIT 20
    `);
    const completed: IncomingQcCompletedRow[] = (
      completedRows as unknown as Array<Record<string, unknown>>
    ).map((r) => {
      const acceptedQty = Number(r['acceptedQty'] ?? 0);
      const rejectedQty = Number(r['rejectedQty'] ?? 0);
      return {
        grnLineId: r['grnLineId'] as string,
        grnId: r['grnId'] as string,
        grnNo: r['grnNo'] as string,
        grnDate: String(r['grnDate']).slice(0, 10),
        qcDate: r['qcDate'] != null ? String(r['qcDate']).slice(0, 10) : null,
        respDays: r['respDays'] != null ? Number(r['respDays']) : null,
        vendorName: (r['vendorName'] as string | null) ?? null,
        itemCode: (r['itemCode'] as string | null) ?? null,
        itemName: (r['itemName'] as string | null) ?? null,
        receivedQty: Number(r['receivedQty'] ?? 0),
        acceptedQty,
        rejectedQty,
        disposition: dispositionOf(acceptedQty, rejectedQty),
        qcRemarks: (r['qcRemarks'] as string | null) ?? null,
      };
    });

    // ── Today's completed totals ──
    const todayRows = await tx.execute(sql`
      SELECT
        COALESCE(SUM(l.qc_accepted_qty), 0)::int AS "todayAcceptedQty",
        COALESCE(SUM(l.qc_rejected_qty), 0)::int AS "todayRejectedQty",
        COUNT(DISTINCT l.goods_receipt_note_id)::int AS "todayAcceptedGrns"
      FROM public.goods_receipt_note_lines l
      WHERE l.company_id = ${companyId}::uuid
        AND l.deleted_at IS NULL
        AND l.qc_status = 'completed'
        AND l.qc_date = CURRENT_DATE
    `);
    const t = (todayRows as unknown as Array<Record<string, unknown>>)[0] ?? {};

    // ── Pipeline metrics derived from the pending set ──
    const grnSet = new Set(pending.map((p) => p.grnId));
    const pendingQty = pending.reduce((s, p) => s + p.pendingQty, 0);
    const avgWaitDays =
      pending.length > 0
        ? Math.round((pending.reduce((s, p) => s + p.waitDays, 0) / pending.length) * 10) / 10
        : 0;
    // pending is ordered oldest-first, so the first row is the oldest.
    const oldest = pending[0] ?? null;
    const metrics: IncomingQcMetrics = {
      grnsWaiting: grnSet.size,
      pendingQty,
      avgWaitDays,
      oldestDays: oldest ? oldest.waitDays : 0,
      oldestGrnNo: oldest ? oldest.grnNo : null,
      valueInQc: Math.round(valueInQc),
      todayAcceptedQty: Number(t['todayAcceptedQty'] ?? 0),
      todayAcceptedGrns: Number(t['todayAcceptedGrns'] ?? 0),
      todayRejectedQty: Number(t['todayRejectedQty'] ?? 0),
    };

    return { metrics, pending, completed };
  });
}
