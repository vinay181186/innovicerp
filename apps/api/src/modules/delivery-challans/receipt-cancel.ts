// DC Receipt (OSP receive-back) — Cancel (ADR-235 Phase C part 2). Only via an
// approved Cancel Request.
//
// Owner rule: a receipt cancels only while the Incoming QC of the GRN it raised
// is untouched. Cancelling the receipt cancels that GRN in the SAME transaction
// (cancelGrnTx with `viaReceipt` — the GRN's own rules, minus "made by a
// receipt"), so nothing moved stock: the receipt only said "these pieces are
// back from the vendor".
//
// The receipt header and its live lines are stamped with ONE soft-delete stamp
// plus cancel_reason / cancelled_at (same instant) / cancelled_by (0221). Every
// reader of received-back figures already skips deleted rows:
//   · sumOrdinaryReceiptsForOp / dcHasActiveReceipts filter the LINE's
//     deleted_at;
//   · isDcFullyReconciled filters both the line's and the header's;
//   · the receive path's over-receive check and the DC cancel's blocker list
//     filter the line's.
// Stamping header AND lines covers every one of them.
//
// Then the forward cascades of the receive are undone — the minimal inverse:
//   · each Job Card op the receipt fed (applyReceiveToJcOp only ever moves an
//     op FORWARD to 'received'): re-read "fully back" from the live receipts
//     (isOspOpFullyBack → sumOrdinaryReceiptsForOp) and put a 'received' op
//     back to 'sent' when it no longer is;
//   · the DC: 'received' → 'issued' when it is no longer fully reconciled, and
//     received_by / received_at re-read from the latest live receipt (cleared
//     when none is left).
// Refused instead of half-undone:
//   · a return-to-vendor replacement receipt (dc.nc_id) — onNcChallanReceived
//     has no inverse yet;
//   · a receipt whose Job Card is already complete (tryCascadeJcComplete may
//     have closed the order line — not unwound here);
//   · an older receipt whose GRN was never linked (0221 backfilled only the
//     certain ones) — it cannot name the GRN it would have to cancel.
//
// LOCK ORDER — DC header first (as the receive and the DC cancel take it), then
// the receipt, its lines (id order), the DC's lines (id order, as the receive
// and the DC cancel take them), then cancelGrnTx's own order (GRN header → GRN
// lines → PO lines), then the Job Card ops (id order). PO lines are NOT locked
// ahead of the GRN: Incoming QC holds a GRN line and then touches its PO line,
// so taking the PO line first here could deadlock with it.

import {
  ActivityAction,
  opSrNo,
  roundQty,
  type CancelBlocker,
  type CancelEffect,
} from '@innovic/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  deliveryChallanLines,
  deliveryChallanReceiptLines,
  deliveryChallanReceipts,
  deliveryChallans,
  jcOps,
} from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { softDeleteStamp } from '../../lib/audit-trail';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import { blockerRefusal } from '../cancel-requests/messages';
import { cancelGrnTx, grnCancelBlockers, lockGrnForCancel } from '../goods-receipt-notes/cancel';
import { isDcFullyReconciled, isOspOpFullyBack } from './receipt-cascades';

export interface DcReceiptCancelHead {
  id: string;
  receiptCode: string;
  deliveryChallanId: string;
  goodsReceiptNoteId: string | null;
  deletedAt: unknown;
  cancelledAt: unknown;
  dcCode: string;
  dcStatus: string;
  dcNcId: string | null;
}

async function readHead(
  tx: DbTransaction,
  companyId: string,
  id: string,
  forUpdate: boolean,
): Promise<DcReceiptCancelHead | null> {
  const rows = (await tx.execute(sql`
    SELECT r.id, r.receipt_code AS "receiptCode",
           r.delivery_challan_id AS "deliveryChallanId",
           r.goods_receipt_note_id AS "goodsReceiptNoteId",
           r.deleted_at AS "deletedAt", r.cancelled_at AS "cancelledAt",
           dc.code AS "dcCode", dc.status::text AS "dcStatus", dc.nc_id AS "dcNcId"
      FROM public.delivery_challan_receipts r
      JOIN public.delivery_challans dc ON dc.id = r.delivery_challan_id
     WHERE r.id = ${id}::uuid AND r.company_id = ${companyId}::uuid
       AND (r.deleted_at IS NULL OR r.cancelled_at IS NOT NULL)
     ${forUpdate ? sql`FOR UPDATE OF r` : sql``}
  `)) as unknown as DcReceiptCancelHead[];
  return rows[0] ?? null;
}

/** Read the receipt — cancelled ones included (a cancel stamps deleted_at).
 *  `forUpdate` locks the DC header FIRST (the order the receive and the DC
 *  cancel take), then the receipt; the preview reads without a lock. null = not
 *  in this company, or deleted without a cancel. */
export async function lockDcReceiptForCancel(
  tx: DbTransaction,
  companyId: string,
  id: string,
  forUpdate: boolean,
): Promise<DcReceiptCancelHead | null> {
  const peek = await readHead(tx, companyId, id, false);
  if (!peek || !forUpdate) return peek;
  await tx.execute(sql`
    SELECT id FROM public.delivery_challans
     WHERE id = ${peek.deliveryChallanId}::uuid AND company_id = ${companyId}::uuid
     FOR UPDATE
  `);
  return readHead(tx, companyId, id, true);
}

interface ReceiptLineFacts {
  id: string;
  dcLineId: string;
  dcLineNo: number;
  purchaseOrderLineId: string | null;
  qty: number;
}

/** The receipt's live lines with their DC line (effects, blockers, worker). */
async function readReceiptLines(
  tx: DbTransaction,
  companyId: string,
  receiptId: string,
): Promise<ReceiptLineFacts[]> {
  const rows = (await tx.execute(sql`
    SELECT rl.id, rl.delivery_challan_line_id AS "dcLineId", dl.line_no AS "dcLineNo",
           dl.purchase_order_line_id AS "purchaseOrderLineId",
           (rl.received_qty + rl.rejected_qty)::float8 AS qty
      FROM public.delivery_challan_receipt_lines rl
      JOIN public.delivery_challan_lines dl ON dl.id = rl.delivery_challan_line_id
     WHERE rl.receipt_id = ${receiptId}::uuid AND rl.company_id = ${companyId}::uuid
       AND rl.deleted_at IS NULL
     ORDER BY dl.line_no, rl.id
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r['id']),
    dcLineId: String(r['dcLineId']),
    dcLineNo: Number(r['dcLineNo']),
    purchaseOrderLineId: (r['purchaseOrderLineId'] as string | null) ?? null,
    qty: roundQty(Number(r['qty'] ?? 0)),
  }));
}

interface OpFacts {
  opId: string;
  opSeq: number;
  jobCardId: string;
  jcCode: string;
  jcDone: boolean;
}

/** The outsource ops these PO lines feed — the same hop applyReceiveToJcOp
 *  takes (jc_op_po_lines, op_type 'outsource'), one row per (PO line, op). */
async function readOpsForPoLines(
  tx: DbTransaction,
  companyId: string,
  poLineIds: readonly string[],
): Promise<Array<OpFacts & { poLineId: string }>> {
  if (poLineIds.length === 0) return [];
  const rows = (await tx.execute(sql`
    SELECT DISTINCT ON (l.purchase_order_line_id)
           l.purchase_order_line_id AS "poLineId",
           o.id AS "opId", o.op_seq AS "opSeq", o.job_card_id AS "jobCardId",
           jc.code AS "jcCode",
           (jc.closed_at IS NOT NULL
             OR COALESCE(vs.computed_status, '') IN ('complete', 'closed')) AS "jcDone"
      FROM public.jc_op_po_lines l
      JOIN public.jc_ops o ON o.id = l.jc_op_id
      JOIN public.job_cards jc ON jc.id = o.job_card_id
      LEFT JOIN public.v_jc_status vs ON vs.job_card_id = jc.id
     WHERE l.purchase_order_line_id = ANY(${sql.param(Array.from(poLineIds))}::uuid[])
       AND l.company_id = ${companyId}::uuid AND l.deleted_at IS NULL
       AND o.company_id = ${companyId}::uuid AND o.deleted_at IS NULL
       AND o.op_type = 'outsource'
     ORDER BY l.purchase_order_line_id, o.id
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    poLineId: String(r['poLineId']),
    opId: String(r['opId']),
    opSeq: Number(r['opSeq']),
    jobCardId: String(r['jobCardId']),
    jcCode: String(r['jcCode'] ?? ''),
    jcDone: r['jcDone'] === true,
  }));
}

/**
 * THE DC receipt cancel refusal rule (one place — the worker under its locks,
 * the Cancel Request service and the preview all call it).
 */
export async function dcReceiptCancelBlockers(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<CancelBlocker[]> {
  const head = await lockDcReceiptForCancel(tx, companyId, id, false);
  if (!head || head.deletedAt != null) return [];
  const dcHref = `/delivery-challans/${head.deliveryChallanId}`;

  // A return-to-vendor replacement: onNcChallanReceived has no inverse, so the
  // NC's rtv figures could not be put back. Refused outright.
  if (head.dcNcId) {
    const nc = (
      (await tx.execute(sql`
        SELECT code FROM public.nc_register
         WHERE id = ${head.dcNcId}::uuid AND company_id = ${companyId}::uuid
      `)) as unknown as Array<{ code: string }>
    )[0];
    return [
      {
        docLabel: 'NC',
        docNo: nc?.code ?? 'NC',
        href: `/nc-register/${head.dcNcId}`,
        reason: 'return-to-vendor replacement — cannot be cancelled yet',
      },
    ];
  }

  const out: CancelBlocker[] = [];
  if (!head.goodsReceiptNoteId) {
    out.push({
      docLabel: 'DC Receipt',
      docNo: head.receiptCode,
      href: dcHref,
      reason: 'older receipt — its GRN is not linked, so it cannot be cancelled',
    });
  } else {
    const grn = await lockGrnForCancel(tx, companyId, head.goodsReceiptNoteId, false);
    if (!grn || grn.deletedAt != null) {
      out.push({
        docLabel: 'GRN',
        docNo: grn?.code ?? 'GRN',
        href: dcHref,
        reason: 'its GRN is already cancelled or deleted — report this to the administrator',
      });
    } else {
      const grnBlockers = await grnCancelBlockers(tx, companyId, grn.id, { viaReceipt: true });
      for (const b of grnBlockers) {
        out.push({ ...b, reason: `on its ${grn.code}: ${b.reason}` });
      }
      // A staged GRN edit (ADR-202) would be applied to a cancelled GRN.
      const staged = (await tx.execute(sql`
        SELECT 1 FROM public.document_edit_requests
         WHERE company_id = ${companyId}::uuid AND entity = 'GoodsReceiptNote'
           AND entity_id = ${grn.id}::uuid AND status = 'pending' AND deleted_at IS NULL
         LIMIT 1
      `)) as unknown as unknown[];
      if (staged.length > 0) {
        out.push({
          docLabel: 'GRN',
          docNo: grn.code,
          href: `/goods-receipt-notes/${grn.id}`,
          reason: 'it has an edit waiting for approval — decide it first',
        });
      }
    }
  }

  // A Job Card the receipt's work already completed is not reopened here.
  const lines = await readReceiptLines(tx, companyId, id);
  const poLineIds = Array.from(
    new Set(lines.flatMap((l) => (l.purchaseOrderLineId ? [l.purchaseOrderLineId] : []))),
  );
  const seenJc = new Set<string>();
  for (const op of await readOpsForPoLines(tx, companyId, poLineIds)) {
    if (!op.jcDone || seenJc.has(op.jobCardId)) continue;
    seenJc.add(op.jobCardId);
    out.push({
      docLabel: 'Job Card',
      docNo: op.jcCode,
      href: `/job-cards/${op.jobCardId}`,
      reason: 'it is already complete — cannot be reopened by a receipt cancel',
    });
  }
  return out;
}

/** What the cancel will do — shown before the user commits. */
export async function dcReceiptCancelEffects(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<CancelEffect[]> {
  const head = await lockDcReceiptForCancel(tx, companyId, id, false);
  if (!head || head.deletedAt != null) return [];
  const lines = await readReceiptLines(tx, companyId, id);
  const poLineIds = Array.from(
    new Set(lines.flatMap((l) => (l.purchaseOrderLineId ? [l.purchaseOrderLineId] : []))),
  );
  const opByPoLine = new Map(
    (await readOpsForPoLines(tx, companyId, poLineIds)).map((o) => [o.poLineId, o]),
  );

  const out: CancelEffect[] = [];
  const byOp = new Map<string, { text: string; qty: number }>();
  for (const l of lines) {
    const op = l.purchaseOrderLineId ? opByPoLine.get(l.purchaseOrderLineId) : undefined;
    const key = op ? `op:${op.opId}` : `ln:${l.dcLineId}`;
    const label = op ? `${op.jcCode} Op ${opSrNo(op.opSeq)}` : `${head.dcCode} Ln ${l.dcLineNo}`;
    const prev = byOp.get(key);
    byOp.set(key, { text: label, qty: roundQty((prev?.qty ?? 0) + l.qty) });
  }
  for (const v of byOp.values()) {
    out.push({ kind: 'reopen', text: `${v.text}: ${v.qty} back to At Vendor`, qty: v.qty });
  }
  if (head.dcStatus === 'received') {
    out.push({ kind: 'reopen', text: `${head.dcCode} goes back to Issued`, qty: null });
  }
  if (head.goodsReceiptNoteId) {
    const grn = await lockGrnForCancel(tx, companyId, head.goodsReceiptNoteId, false);
    out.push({
      kind: 'note',
      text: `${grn?.code ?? 'Its GRN'} is cancelled with it — no stock moved`,
      qty: null,
    });
  }
  return out;
}

/**
 * The ONE DC receipt cancel writer, run only by an approved Cancel Request
 * (ADR-235), in the caller's transaction. No rights check — the Cancel Request
 * checks the ospdc_create ticks.
 */
export async function cancelDcReceiptTx(
  tx: DbTransaction,
  companyId: string,
  id: string,
  reason: string,
  user: AuthContext,
): Promise<void> {
  const trimmed = (reason ?? '').trim();
  if (!trimmed) throw new ValidationError('Reason is required to cancel a DC receipt.');

  // DC header, then the receipt (lockDcReceiptForCancel), then re-check live.
  const head = await lockDcReceiptForCancel(tx, companyId, id, true);
  if (!head) throw new NotFoundError('DC receipt not found. Refresh the page.');
  if (head.deletedAt != null || head.cancelledAt != null) {
    throw new ConflictError(`${head.receiptCode} is already cancelled. Refresh the page.`);
  }
  const dcId = head.deliveryChallanId;

  // The receipt's lines, then the DC's lines — both id order.
  await tx
    .select({ id: deliveryChallanReceiptLines.id })
    .from(deliveryChallanReceiptLines)
    .where(
      and(
        eq(deliveryChallanReceiptLines.receiptId, id),
        eq(deliveryChallanReceiptLines.companyId, companyId),
        isNull(deliveryChallanReceiptLines.deletedAt),
      ),
    )
    .orderBy(asc(deliveryChallanReceiptLines.id))
    .for('update');
  await tx
    .select({ id: deliveryChallanLines.id })
    .from(deliveryChallanLines)
    .where(
      and(eq(deliveryChallanLines.deliveryChallanId, dcId), isNull(deliveryChallanLines.deletedAt)),
    )
    .orderBy(asc(deliveryChallanLines.id))
    .for('update');

  // The refusal rule, under the locks — before anything moves.
  const blockers = await dcReceiptCancelBlockers(tx, companyId, id);
  if (blockers.length > 0) {
    throw new ConflictError(blockerRefusal(head.receiptCode, blockers), { blockers });
  }
  // The rule above refuses a receipt with no GRN; this narrows the type.
  const grnId = head.goodsReceiptNoteId;
  if (!grnId) throw new ConflictError(`${head.receiptCode}: its GRN is not linked.`);

  const lines = await readReceiptLines(tx, companyId, id);
  const totalQty = roundQty(lines.reduce((s, l) => s + l.qty, 0));

  // 1. Its GRN goes with it (the one GRN cancel writer; PO-line received qty
  //    and PO status recalculated there).
  const grn = await cancelGrnTx(tx, companyId, grnId, trimmed, user, { viaReceipt: true });

  // 2. ONE stamp for the receipt header and its lines.
  const stamp = softDeleteStamp(user);
  await tx
    .update(deliveryChallanReceiptLines)
    .set({ ...stamp, updatedAt: stamp.deletedAt, updatedBy: user.id })
    .where(
      and(
        eq(deliveryChallanReceiptLines.receiptId, id),
        eq(deliveryChallanReceiptLines.companyId, companyId),
        isNull(deliveryChallanReceiptLines.deletedAt),
      ),
    );
  // §20.2 — cancel once: only a still-live receipt moves.
  const moved = await tx
    .update(deliveryChallanReceipts)
    .set({
      ...stamp,
      cancelReason: trimmed,
      cancelledAt: stamp.deletedAt,
      cancelledBy: user.id,
      updatedAt: stamp.deletedAt,
      updatedBy: user.id,
    })
    .where(
      and(
        eq(deliveryChallanReceipts.id, id),
        eq(deliveryChallanReceipts.companyId, companyId),
        isNull(deliveryChallanReceipts.deletedAt),
      ),
    )
    .returning({ id: deliveryChallanReceipts.id });
  if (moved.length === 0) {
    throw new ConflictError(
      `${head.receiptCode} has just been cancelled by someone else. Refresh the page.`,
    );
  }

  // 3. The Job Card ops it fed: 'received' → 'sent' when the live receipts no
  //    longer cover the op's sent qty (the inverse of applyReceiveToJcOp).
  const poLineIds = Array.from(
    new Set(lines.flatMap((l) => (l.purchaseOrderLineId ? [l.purchaseOrderLineId] : []))),
  );
  const ops = await readOpsForPoLines(tx, companyId, poLineIds);
  const opIds = Array.from(new Set(ops.map((o) => o.opId))).sort();
  const reopened: Array<OpFacts & { qty: number }> = [];
  if (opIds.length > 0) {
    const locked = (await tx.execute(sql`
      SELECT o.id, o.outsource_status::text AS status, o.outsource_sent_qty AS "sentQty"
        FROM public.jc_ops o
       WHERE o.id = ANY(${sql.param(opIds)}::uuid[]) AND o.company_id = ${companyId}::uuid
       ORDER BY o.id
       FOR UPDATE
    `)) as unknown as Array<{ id: string; status: string | null; sentQty: number }>;
    for (const row of locked) {
      if (row.status !== 'received') continue;
      const { fullyBack } = await isOspOpFullyBack(tx, companyId, row.id, Number(row.sentQty));
      if (fullyBack) continue;
      const back = await tx
        .update(jcOps)
        .set({ outsourceStatus: 'sent', updatedBy: user.id })
        .where(and(eq(jcOps.id, row.id), eq(jcOps.outsourceStatus, 'received')))
        .returning({ id: jcOps.id });
      const op = ops.find((o) => o.opId === row.id);
      if (back.length > 0 && op) {
        const qty = roundQty(
          lines
            .filter((l) =>
              ops.some((o) => o.opId === row.id && o.poLineId === l.purchaseOrderLineId),
            )
            .reduce((s, l) => s + l.qty, 0),
        );
        reopened.push({ ...op, qty });
      }
    }
  }

  // 4. The DC: who booked the latest live receipt (cleared when none is left),
  //    and 'received' → 'issued' when it is no longer fully reconciled.
  const latest = (await tx.execute(sql`
    SELECT created_by AS "by", created_at AS "at"
      FROM public.delivery_challan_receipts
     WHERE delivery_challan_id = ${dcId}::uuid AND company_id = ${companyId}::uuid
       AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1
  `)) as unknown as Array<{ by: string; at: Date | string }>;
  const now = new Date();
  await tx
    .update(deliveryChallans)
    .set({
      receivedBy: latest[0]?.by ?? null,
      receivedAt: latest[0] ? new Date(latest[0].at) : null,
      updatedBy: user.id,
      updatedAt: now,
    })
    .where(and(eq(deliveryChallans.id, dcId), eq(deliveryChallans.companyId, companyId)));
  let dcReopened = false;
  if (head.dcStatus === 'received' && !(await isDcFullyReconciled(tx, dcId))) {
    const flipped = await tx
      .update(deliveryChallans)
      .set({ status: 'issued', updatedBy: user.id, updatedAt: now })
      .where(and(eq(deliveryChallans.id, dcId), eq(deliveryChallans.status, 'received')))
      .returning({ id: deliveryChallans.id });
    dcReopened = flipped.length > 0;
  }

  // 5. History: the CANCEL on the receipt, a REVERSE on the DC and on each op.
  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Cancel,
      entity: 'DeliveryChallanReceipt',
      entityId: id,
      refId: head.receiptCode,
      qty: totalQty,
      reason: trimmed,
      detail: `${head.receiptCode} cancelled — ${totalQty} back to At Vendor on ${head.dcCode}; ${grn.code} cancelled with it, no stock moved`,
    },
    companyId,
    user,
  );
  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Reverse,
      entity: 'DeliveryChallan',
      entityId: dcId,
      refId: head.dcCode,
      qty: totalQty,
      reason: trimmed,
      detail:
        `${head.dcCode} — receipt ${head.receiptCode} cancelled (${totalQty} back to At Vendor)` +
        (dcReopened ? '; back to Issued' : ''),
    },
    companyId,
    user,
  );
  for (const op of reopened) {
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Reverse,
        entity: 'JobCard',
        entityId: op.jobCardId,
        refId: op.jcCode,
        opRef: `Op ${opSrNo(op.opSeq)}`,
        qty: op.qty,
        reason: trimmed,
        detail: `${op.jcCode} Op ${opSrNo(op.opSeq)} — back to At Vendor (${head.receiptCode} cancelled)`,
      },
      companyId,
      user,
    );
  }
}
