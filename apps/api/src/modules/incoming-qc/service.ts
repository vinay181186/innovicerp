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
import {
  goodsReceiptNoteLines,
  goodsReceiptNotes,
  jcOps,
  jobCards,
  opLog,
  purchaseOrderLines,
} from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { canSeeFormPrice, requireFormAccess } from '../../lib/access';
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
import { autoCreateNcFromQcReject } from '../nc-register/cascades';
import { onNcReplacementQc } from '../nc-register/recovery';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

/** Today's date in IST (fixed UTC+5:30, no DST) — the shop's calendar day,
 *  matching op-entry's own `istToday`. A UTC slice would date a late-evening
 *  inspection on yesterday. */
function istToday(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Same marker op-entry's nextLogNo() writes: not unique by spec (ADR-011 #4),
 *  the uuid PK is the addressable id. Copied rather than imported so this
 *  module does not pull the whole op-entry service in for one string. */
function nextLogNo(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, '')
    .slice(0, 14);
  return `LOG-${stamp}`;
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
  // Dual-lane (ADR-081): also credit the return onto a PROCESS op that carries an
  // OSP balance (it has a sent qty), not only whole op_type='outsource' ops.
  if (!op) return;
  if (op.opType !== 'outsource' && (op.sentQty ?? 0) <= 0) return;
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

/**
 * §7 OSP QC de-duplication (docs/QC-NC-HANDLING-DESIGN.md §6).
 *
 * The procedure forbids inspecting the same pieces twice: when an outsourced
 * op is followed by a QC op on the route, the vendor's returned pieces get ONE
 * inspection — Incoming QC — and that inspection IS the route's QC. Before
 * this, the QC op still showed the whole returned qty as "QC pending" and the
 * inspector had to key the identical accept/reject a second time, raising a
 * second NC for the same rejects.
 *
 * So after the GRN line result is written, mirror THIS submission's delta
 * (accepted, rejected — never the line's running totals, because a line can be
 * inspected in several sittings) as one qc op_log row on the very next op of
 * the same job card when that op is a QC op. Written directly, not through
 * submitQcLog: that path would raise a second NC for the reject, and the NC
 * for these pieces was already raised by the Incoming QC reject above. The QC
 * op then reads qc_pending = 0 for those pieces and the accepted ones flow on.
 *
 * Only op_seq + 1 qualifies, and only op_type = 'qc'. A QC op two steps down
 * inspects something else (another process has happened in between), and a
 * process op next in line needs no mirror — the outsource op's own output
 * already feeds it. No-op when the source op is not an outsource op.
 */
async function mirrorIncomingQcOntoNextQcOp(
  tx: DbTransaction,
  companyId: string,
  sourceJcOpId: string | null,
  acceptedDelta: number,
  rejectedDelta: number,
  user: AuthContext,
): Promise<void> {
  // Only the ACCEPTED pieces are mirrored. The following QC op's input is the
  // outsource op's output, which is the GRN-accepted qty alone -- a piece
  // rejected at Incoming QC never reaches the next op, so writing its reject
  // there too would make that op's inspected qty exceed its input and count
  // the same reject twice (once on the outsource op via the GRN line, once
  // here). The reject is already fully recorded: on the GRN line, and as the
  // NC raised against the outsource op.
  if (!sourceJcOpId || acceptedDelta <= 0) return;
  const srcRows = await tx
    .select({ jobCardId: jcOps.jobCardId, opSeq: jcOps.opSeq, opType: jcOps.opType })
    .from(jcOps)
    .where(
      and(eq(jcOps.id, sourceJcOpId), eq(jcOps.companyId, companyId), isNull(jcOps.deletedAt)),
    )
    .limit(1);
  const src = srcRows[0];
  if (!src || src.opType !== 'outsource') return;
  const nextRows = await tx
    .select({ id: jcOps.id, opType: jcOps.opType })
    .from(jcOps)
    .where(
      and(
        eq(jcOps.jobCardId, src.jobCardId),
        eq(jcOps.opSeq, src.opSeq + 1),
        eq(jcOps.companyId, companyId),
        isNull(jcOps.deletedAt),
      ),
    )
    .limit(1);
  const next = nextRows[0];
  if (!next || next.opType !== 'qc') return;
  await tx.insert(opLog).values({
    companyId,
    jcOpId: next.id,
    logNo: nextLogNo(),
    logType: 'qc',
    logDate: istToday(),
    shift: 'day',
    qty: acceptedDelta,
    rejectQty: 0,
    operatorId: null,
    operatorName: user.fullName ?? user.email,
    // No machine on QC: inspection is not machining (op-entry, ISSUE-010).
    machineId: null,
    remarks: 'Incoming QC (auto — same inspection)',
    createdBy: user.id,
  });
}

export async function getIncomingQc(user: AuthContext): Promise<IncomingQcResponse> {
  const companyId = requireCompany(user);
  // Money-hiding for L1 Viewers ("Can See Price"): the "Value in QC" figure
  // rides the Incoming-QC price permission.
  const showMoney = await canSeeFormPrice(user, 'qc_incoming');
  return withUserContext(user, async (tx) => {
    // ── Pending lines (received but not fully inspected) ──
    const pendingRows = await tx.execute(sql`
      SELECT
        l.id AS "grnLineId", h.id AS "grnId", h.code AS "grnNo", h.grn_date AS "grnDate",
        h.po_code_text AS "poCode",
        COALESCE(v.name, h.vendor_code_text) AS "vendorName",
        so.code AS "soCode",
        jc.code AS "jcCode", jco.op_seq AS "opSeq", jco.operation AS "opName",
        COALESCE(i.code, l.item_code_text) AS "itemCode",
        -- The customer's drawing revision, off the same PO line -> jc_op -> JC ->
        -- SO line trace that yields soCode above. This queue mixes two kinds of
        -- row: an OSP return reaches an SO line and carries a revision, while a
        -- raw-material receipt from a vendor has no SO behind it and is null here
        -- -- correctly, since there is no customer drawing for it. It is NOT
        -- items.revision, a different column about the item master.
        --
        -- Cast to text on purpose: the contract types this as a string, and the
        -- column is only text on a database that has had migration 0119. On one
        -- that has not it is still the old integer and would arrive here as a
        -- number wearing a string type. The cast is a no-op once 0119 is in.
        sol.revision::text AS "itemRevision",
        COALESCE(i.name, l.item_name) AS "itemName",
        l.received_qty AS "receivedQty",
        (l.received_qty - l.qc_accepted_qty - l.qc_rejected_qty) AS "pendingQty",
        GREATEST(0, (CURRENT_DATE - h.grn_date))::int AS "waitDays",
        COALESCE(pol.rate, 0) AS "rate"
      FROM public.goods_receipt_note_lines l
      JOIN public.goods_receipt_notes h ON h.id = l.goods_receipt_note_id AND h.deleted_at IS NULL
      LEFT JOIN public.purchase_order_lines pol ON pol.id = l.purchase_order_line_id
      -- SO trace for OSP returns: PO line → jc_op → JC → SO line → SO (null for raw-material GRNs).
      LEFT JOIN public.jc_ops jco ON jco.id = pol.source_jc_op_id AND jco.deleted_at IS NULL
      LEFT JOIN public.job_cards jc ON jc.id = jco.job_card_id AND jc.deleted_at IS NULL
      LEFT JOIN public.sales_order_lines sol ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
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
      soCode: (r['soCode'] as string | null) ?? null,
      jcCode: (r['jcCode'] as string | null) ?? null,
      opSeq: r['opSeq'] != null ? Number(r['opSeq']) : null,
      opName: (r['opName'] as string | null) ?? null,
      itemCode: (r['itemCode'] as string | null) ?? null,
      itemRevision: (r['itemRevision'] as string | null) ?? null,
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
        -- The drawing revision the receipt was inspected against, traced exactly
        -- as on the pending query: PO line -> jc_op -> JC -> SO line. Null on a
        -- raw-material receipt, which has no SO behind it. Cast to text so a
        -- pre-0119 database cannot hand the UI a number. Never items.revision.
        sol.revision::text AS "itemRevision",
        COALESCE(i.name, l.item_name) AS "itemName",
        l.received_qty AS "receivedQty",
        l.qc_accepted_qty AS "acceptedQty", l.qc_rejected_qty AS "rejectedQty",
        l.qc_remarks AS "qcRemarks",
        l.updated_at AS "qcAt",
        COALESCE(l.qc_inspected_by_text, u.full_name, u.email) AS "qcInspectedBy",
        l.qc_report_path AS "qcReportPath", l.qc_report_name AS "qcReportName"
      FROM public.goods_receipt_note_lines l
      JOIN public.goods_receipt_notes h ON h.id = l.goods_receipt_note_id AND h.deleted_at IS NULL
      LEFT JOIN public.vendors v ON v.id = h.vendor_id AND v.deleted_at IS NULL
      -- The completed feed carried no SO trace before the drawing revision needed
      -- one. These are the same four LEFT JOINs the pending query uses, and they
      -- stay LEFT so a raw-material receipt still appears with a null revision.
      LEFT JOIN public.purchase_order_lines pol ON pol.id = l.purchase_order_line_id
      LEFT JOIN public.jc_ops jco ON jco.id = pol.source_jc_op_id AND jco.deleted_at IS NULL
      LEFT JOIN public.job_cards jc ON jc.id = jco.job_card_id AND jc.deleted_at IS NULL
      LEFT JOIN public.sales_order_lines sol ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.items i ON i.id = l.item_id
      LEFT JOIN public.users u ON u.id = l.qc_inspected_by
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
        itemRevision: (r['itemRevision'] as string | null) ?? null,
        itemName: (r['itemName'] as string | null) ?? null,
        receivedQty: Number(r['receivedQty'] ?? 0),
        acceptedQty,
        rejectedQty,
        disposition: dispositionOf(acceptedQty, rejectedQty, Number(r['receivedQty'] ?? 0)),
        qcAt: r['qcAt'] != null ? String(r['qcAt']) : null,
        qcInspectedBy: (r['qcInspectedBy'] as string | null) ?? null,
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
      valueInQc: showMoney ? Math.round(valueInQc) : null,
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
  // ADR-035: enforce the per-department QC tier, not just the role — a user
  // with Incoming QC view-only (L1) must not accept/reject received goods even
  // if their global role is manager. Admins bypass.
  await requireFormAccess(user, 'qc_incoming', 'entry');
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
        // Set when this GRN is the vendor's REPLACEMENT for a return-to-vendor
        // NC (design §5): the inspection then settles that NC, not a fresh one.
        ncId: goodsReceiptNotes.ncId,
      })
      .from(goodsReceiptNoteLines)
      .innerJoin(
        goodsReceiptNotes,
        eq(goodsReceiptNotes.id, goodsReceiptNoteLines.goodsReceiptNoteId),
      )
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
    // One inspection date for the line stamp, the NC and the replacement
    // cascade, so the three can never disagree about when this happened.
    const qcDate = input.qcDate ?? istToday();

    await tx
      .update(goodsReceiptNoteLines)
      .set({
        qcStatus: fullyDone ? 'completed' : 'in_progress',
        qcAcceptedQty: newAccepted,
        qcRejectedQty: newRejected,
        qcDate,
        // WHO INSPECTED vs WHO TYPED IT IN — routinely two different people.
        // `qc_inspected_by` is the inspector picked from the QC user list; it
        // falls back to the submitter only when no user was picked (import, or
        // an inspector with no login). The submitter stays traceable through
        // `updated_by` below. The text stays a snapshot of the name signed off
        // on the day, so it does not change if that person is later renamed.
        qcInspectedBy: input.qcInspectedByUserId ?? user.id,
        qcInspectedByText: input.qcInspectedByName,
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
        //
        // Also run for a return-to-vendor REPLACEMENT (line.ncId set). It is
        // not a double credit: outsource_returned_qty only ever counted pieces
        // ACCEPTED at Incoming QC, so the pieces this NC covers were rejected
        // and never credited — the vendor still owed them against the op's
        // sent qty. The replacement's accepted pieces are that debt being
        // paid, and without this credit `returned` could never reach `sent`
        // and the op would sit at 'sent' with the material in the building.
        await creditOutsourceReturn(tx, poRows[0].sourceJcOpId, input.acceptedQty, user.id);
        if (!line.ncId) {
          await mirrorIncomingQcOntoNextQcOp(
            tx,
            companyId,
            poRows[0].sourceJcOpId,
            input.acceptedQty,
            input.rejectedQty,
            user,
          );
        }
      }
    }

    // Return-to-vendor replacement (design §5): this inspection settles the
    // NC that sent the pieces back — cleared/failed on the NC, close when the
    // gate is met, and for an in-house-origin NC the accepted pieces re-enter
    // the origin op. That re-injection is why the §7 mirror above is skipped
    // here: the cascade already puts the pieces back where they belong, and a
    // second qc row on the following QC op would inspect them twice on paper.
    // Rejected pieces raise their follow-on NC below through the same auto-NC
    // path as any other Incoming QC reject.
    if (line.ncId) {
      await onNcReplacementQc(
        tx,
        {
          ncId: line.ncId,
          acceptedQty: input.acceptedQty,
          rejectedQty: input.rejectedQty,
          grnLineId: line.id,
          logDate: qcDate,
        },
        companyId,
        user,
      );
    }

    // A reject at Incoming QC raises a defect record (NC), mirroring production
    // QC (op-entry submitQcLog, T-040e). This is the SINGLE place vendor-return
    // rejects are captured now that the receive step no longer takes a reject
    // qty — so the reject decision and its NC both live at QC.
    //
    // Phase 1 covers JOB-WORK returns only: the GRN line must trace back through
    // its PO line to a jc_op with a job card. Raw-material rejects (no source
    // jc_op / no job card) currently raise no NC — a job-card-less NC needs a
    // schema change (planned as a separate phase).
    if (input.rejectedQty > 0 && line.poLineId) {
      const jcOpRows = await tx
        .select({
          jcOpId: jcOps.id,
          jobCardId: jcOps.jobCardId,
          opSeq: jcOps.opSeq,
          operation: jcOps.operation,
          jcCode: jobCards.code,
        })
        .from(purchaseOrderLines)
        .innerJoin(
          jcOps,
          and(eq(jcOps.id, purchaseOrderLines.sourceJcOpId), isNull(jcOps.deletedAt)),
        )
        .innerJoin(jobCards, and(eq(jobCards.id, jcOps.jobCardId), isNull(jobCards.deletedAt)))
        .where(eq(purchaseOrderLines.id, line.poLineId))
        .limit(1);
      const src = jcOpRows[0];
      if (src) {
        await autoCreateNcFromQcReject(
          tx,
          {
            companyId,
            jobCardId: src.jobCardId,
            jcOpId: src.jcOpId,
            jcCode: src.jcCode,
            opSeq: src.opSeq,
            operationText: src.operation,
            rejectedQty: input.rejectedQty,
            ncDate: qcDate,
            reportedByText: input.qcInspectedByName ?? null,
            remarks: input.qcRemarks ?? null,
            // The GRN line this reject was found on (design §3,
            // nc_register.grn_line_id) — the receipt end of the trail.
            grnLineId: line.id,
          },
          user,
        );
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
