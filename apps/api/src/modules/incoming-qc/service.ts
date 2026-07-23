// Incoming QC service (QC Wave 2) — read-only.
//
// GET /incoming-qc — inspection queue for received GRN lines awaiting QC, +
// pipeline metrics + recently-completed lines. Mirrors legacy renderIncomingQC
// (HTML L23748). Raw SQL over goods_receipt_note_lines ⨝ headers ⨝ vendors ⨝
// items. RLS via base tables. The Inspect action lives on the GRN detail page
// (existing goods-receipt-notes update flow), so there is no write here.

import { and, eq, isNull, sql } from 'drizzle-orm';
import type {
  IncomingQcCompletedRow,
  IncomingQcMetrics,
  IncomingQcPendingRow,
  IncomingQcResponse,
  SubmitIncomingQcInput,
} from '@innovic/shared';
import { goodsReceiptNoteLines, jcOps, purchaseOrderLines } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireWriteRole } from '../../lib/auth';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import {
  creditGrnQcStock,
  recalcPoHeaderStatus,
  recalcPoLineReceivedQty,
} from '../goods-receipt-notes/cascades';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function dispositionOf(
  accepted: number,
  rejected: number,
  received: number,
): IncomingQcCompletedRow['disposition'] {
  // Still some qty awaiting inspection → the line is only partially done.
  if (received - accepted - rejected > 0) return 'Partial Accept';
  if (accepted > 0 && rejected > 0) return 'Partial Accept';
  if (rejected > 0) return 'Rejected';
  return 'Accepted';
}

/**
 * Step-6 completion for OSP: push the newly QC-accepted qty back onto the
 * outsource jc_op this GRN line came from (via its PO line's source_jc_op_id),
 * so the operation records how much genuinely returned. `outsource_returned_qty`
 * is what customer-dispatch readiness reads, so this is what makes a partial
 * outsource return dispatchable. No-op unless the op is an outsource op and a
 * positive qty was accepted. Runs in the caller's tx.
 */
async function creditOutsourceReturn(
  tx: DbTransaction,
  jcOpId: string | null,
  acceptedDelta: number,
  userId: string,
): Promise<void> {
  if (!jcOpId || acceptedDelta <= 0) return;
  const opRows = await tx
    .select({
      id: jcOps.id,
      opType: jcOps.opType,
      sentQty: jcOps.outsourceSentQty,
      returnedQty: jcOps.outsourceReturnedQty,
    })
    .from(jcOps)
    .where(and(eq(jcOps.id, jcOpId), isNull(jcOps.deletedAt)))
    .limit(1);
  const op = opRows[0];
  if (!op || op.opType !== 'outsource') return;
  const newReturned = (op.returnedQty ?? 0) + acceptedDelta;
  const fullyReturned = op.sentQty > 0 && newReturned >= op.sentQty;
  await tx
    .update(jcOps)
    .set({
      outsourceReturnedQty: newReturned,
      // Flip to 'received' once the whole sent qty is back; partials keep their
      // current status (still 'sent'/'at_vendor') but now carry a return count.
      ...(fullyReturned ? { outsourceStatus: 'received' as const } : {}),
      updatedBy: userId,
    })
    .where(eq(jcOps.id, op.id));
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
        l.qc_remarks AS "qcRemarks",
        l.qc_report_path AS "qcReportPath", l.qc_report_name AS "qcReportName"
      FROM public.goods_receipt_note_lines l
      JOIN public.goods_receipt_notes h ON h.id = l.goods_receipt_note_id AND h.deleted_at IS NULL
      LEFT JOIN public.vendors v ON v.id = h.vendor_id AND v.deleted_at IS NULL
      LEFT JOIN public.items i ON i.id = l.item_id
      -- Any line that has had QC activity (accepted and/or rejected), incl.
      -- partially-inspected lines still carrying a pending balance — so a
      -- partial accept is logged here immediately, not only once fully resolved.
      WHERE l.company_id = ${companyId}::uuid
        AND l.deleted_at IS NULL
        AND (l.qc_accepted_qty > 0 OR l.qc_rejected_qty > 0)
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
        disposition: dispositionOf(acceptedQty, rejectedQty, Number(r['receivedQty'] ?? 0)),
        qcRemarks: (r['qcRemarks'] as string | null) ?? null,
        qcReportPath: (r['qcReportPath'] as string | null) ?? null,
        qcReportName: (r['qcReportName'] as string | null) ?? null,
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
        AND (l.qc_accepted_qty > 0 OR l.qc_rejected_qty > 0)
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

/**
 * Record incoming QC for ONE GRN line (the Incoming QC Call Register inline
 * accept/reject) — INCREMENTALLY. Each call adds this inspection's accept/reject
 * onto the line's running totals, credits ONLY the newly-accepted qty to stock
 * (grn_qc), stamps the inspector, and marks the line 'completed' only once it is
 * fully accounted for (accepted + rejected = received). A partial inspection
 * leaves the line 'in_progress' with the remaining qty, so it stays in the
 * pending queue to be finished later. Narrowed to a single line so it can't
 * disturb the rest of the GRN.
 */
export async function submitIncomingQc(
  grnLineId: string,
  input: SubmitIncomingQcInput,
  user: AuthContext,
): Promise<{ ok: true; grnId: string }> {
  requireWriteRole(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select({
        id: goodsReceiptNoteLines.id,
        grnId: goodsReceiptNoteLines.goodsReceiptNoteId,
        itemId: goodsReceiptNoteLines.itemId,
        receivedQty: goodsReceiptNoteLines.receivedQty,
        acceptedQty: goodsReceiptNoteLines.qcAcceptedQty,
        rejectedQty: goodsReceiptNoteLines.qcRejectedQty,
        poLineId: goodsReceiptNoteLines.purchaseOrderLineId,
      })
      .from(goodsReceiptNoteLines)
      .where(
        and(
          eq(goodsReceiptNoteLines.id, grnLineId),
          eq(goodsReceiptNoteLines.companyId, companyId),
          isNull(goodsReceiptNoteLines.deletedAt),
        ),
      )
      .limit(1);
    const line = rows[0];
    if (!line) throw new NotFoundError(`GRN line ${grnLineId} not found`);

    const priorAccepted = line.acceptedQty ?? 0;
    const priorRejected = line.rejectedQty ?? 0;
    const remaining = line.receivedQty - priorAccepted - priorRejected;
    if (remaining <= 0) {
      throw new ConflictError(
        'This item is already fully inspected — create a reversing GRN line to change it.',
      );
    }
    const thisTotal = input.acceptedQty + input.rejectedQty;
    if (thisTotal > remaining) {
      throw new ValidationError(
        `Accept + reject (${thisTotal}) exceeds the remaining qty (${remaining}).`,
      );
    }

    const newAccepted = priorAccepted + input.acceptedQty;
    const newRejected = priorRejected + input.rejectedQty;
    const fullyDone = line.receivedQty - newAccepted - newRejected <= 0;

    await tx
      .update(goodsReceiptNoteLines)
      .set({
        qcStatus: fullyDone ? 'completed' : 'in_progress',
        qcAcceptedQty: newAccepted,
        qcRejectedQty: newRejected,
        qcDate: input.qcDate ?? new Date().toISOString().slice(0, 10),
        qcInspectedBy: user.id,
        // Keep prior remarks/report when this inspection doesn't supply new ones.
        ...(input.qcRemarks !== undefined ? { qcRemarks: input.qcRemarks } : {}),
        ...(input.qcReportPath !== undefined
          ? { qcReportPath: input.qcReportPath, qcReportName: input.qcReportName ?? null }
          : {}),
        updatedBy: user.id,
      })
      .where(eq(goodsReceiptNoteLines.id, grnLineId));

    // Credit ONLY this inspection's accepted delta to stock (one ledger row per
    // partial accept), independent of whether the line is now fully done.
    await creditGrnQcStock({
      tx,
      companyId,
      adminUserId: user.id,
      grnId: line.grnId,
      grnLineId: line.id,
      itemId: line.itemId,
      qty: input.acceptedQty,
    });
    if (line.poLineId) {
      await recalcPoLineReceivedQty(tx, line.poLineId, user.id);
      const poRows = await tx
        .select({
          poId: purchaseOrderLines.purchaseOrderId,
          sourceJcOpId: purchaseOrderLines.sourceJcOpId,
        })
        .from(purchaseOrderLines)
        .where(eq(purchaseOrderLines.id, line.poLineId))
        .limit(1);
      if (poRows[0]) {
        await recalcPoHeaderStatus(tx, poRows[0].poId, user.id);
        // Step 6: record the accepted qty on the source outsource op so partial
        // returns become visible to the JC (and dispatchable — see Change 2).
        await creditOutsourceReturn(tx, poRows[0].sourceJcOpId, input.acceptedQty, user.id);
      }
    }

    await emitActivityLog(
      tx,
      {
        action: 'EDIT',
        entity: 'GoodsReceiptNote',
        detail: `Incoming QC — ${input.acceptedQty} accepted, ${input.rejectedQty} rejected`,
        refId: line.grnId,
      },
      companyId,
      user,
    );

    return { ok: true as const, grnId: line.grnId };
  });
}
