// Delivery-challan receive-back cascades (T-059b).
//
// Three transactional helpers fired alongside a DC receipt create:
//
//   1. applyReceiveToJcOp(tx, args)
//        For a DC line linked to a JW PO line, find the corresponding outsource
//        jc_op (via jc_ops.outsource_po_line_id) and:
//          - if cumulative received+rejected qty across all receipts on the
//            DC lines linked to this po_line >= outsource_sent_qty, flip
//            outsource_status to 'received'
//          - otherwise leave status as 'sent' (partial receive)
//        Returns the snapshot for audit emission. No-op when no jc_op is
//        linked to the PO line.
//
//   2. writeStoreTxnOnDcReceive(args)
//        Stock IN ledger row mirroring the GRN/QC pattern. Lock items row
//        FOR UPDATE, read v_item_stock, write a store_transactions row.
//        txn_type='in', source_type='jw_in'.
//
// NOTE: reject-at-receive was removed — vendor rejects are now raised as NCs at
// Incoming QC (the single reject surface), so the former
// autoCreateNcFromOutsourceReject helper here was deleted along with the
// receive-time reject field.

import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  deliveryChallanLines,
  deliveryChallanReceiptLines,
  jcOps,
  jobCards,
  storeTransactions,
} from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';

export interface ReceiveCascadeArgs {
  tx: DbTransaction;
  companyId: string;
  adminUserId: string;
  receiptCode: string;
  receiptDate: string; // YYYY-MM-DD
  purchaseOrderLineId: string;
  /** Received qty that just landed in this receipt for this po_line. */
  qtyAdded: number;
}

export interface ReceiveCascadeResult {
  /** True when a matching jc_op was found. */
  fired: boolean;
  jcOpId?: string;
  jcCode?: string;
  jobCardId?: string;
  opSeq?: number;
  prevStatus?: string | null;
  nextStatus?: string;
  /** True when the cumulative-reconciled qty hit outsource_sent_qty. */
  fullyReceived?: boolean;
}

export async function applyReceiveToJcOp(args: ReceiveCascadeArgs): Promise<ReceiveCascadeResult> {
  const { tx, companyId, adminUserId, purchaseOrderLineId } = args;

  const rows = await tx
    .select({
      id: jcOps.id,
      opSeq: jcOps.opSeq,
      jobCardId: jcOps.jobCardId,
      outsourceStatus: jcOps.outsourceStatus,
      outsourceSentQty: jcOps.outsourceSentQty,
    })
    .from(jcOps)
    .where(
      and(
        eq(jcOps.outsourcePoLineId, purchaseOrderLineId),
        eq(jcOps.companyId, companyId),
        eq(jcOps.opType, 'outsource'),
        isNull(jcOps.deletedAt),
      ),
    )
    .limit(1);
  const op = rows[0];
  if (!op) return { fired: false };

  const jcRows = await tx
    .select({ code: jobCards.code })
    .from(jobCards)
    .where(eq(jobCards.id, op.jobCardId))
    .limit(1);
  const jcCode = jcRows[0]?.code ?? '';

  // Sum cumulative received + rejected across ALL active (non-cancelled,
  // non-deleted) receipt lines whose dc_line is linked to this po_line.
  const sumRows = (await tx.execute(sql`
    SELECT COALESCE(SUM(drl.received_qty + drl.rejected_qty), 0)::numeric AS total
    FROM public.delivery_challan_receipt_lines drl
    INNER JOIN public.delivery_challan_lines dcl
      ON dcl.id = drl.delivery_challan_line_id AND dcl.deleted_at IS NULL
    INNER JOIN public.delivery_challans dc
      ON dc.id = dcl.delivery_challan_id
      AND dc.deleted_at IS NULL
      AND dc.status <> 'cancelled'
    WHERE dcl.purchase_order_line_id = ${purchaseOrderLineId}::uuid
      AND drl.deleted_at IS NULL
      AND drl.company_id = ${companyId}::uuid
  `)) as unknown as Array<{ total: string | number }>;
  const cumulative = Number(sumRows[0]?.total ?? 0);

  const prevStatus = op.outsourceStatus ?? null;
  const fullyReceived = cumulative >= op.outsourceSentQty && op.outsourceSentQty > 0;
  const nextStatus = fullyReceived ? 'received' : (prevStatus ?? 'sent');

  if (nextStatus !== prevStatus) {
    await tx
      .update(jcOps)
      .set({
        outsourceStatus: nextStatus as typeof op.outsourceStatus,
        updatedBy: adminUserId,
      })
      .where(eq(jcOps.id, op.id));
  }

  return {
    fired: true,
    jcOpId: op.id,
    jcCode,
    jobCardId: op.jobCardId,
    opSeq: op.opSeq,
    prevStatus,
    nextStatus,
    fullyReceived,
  };
}

export interface DcReceiveStockTxnArgs {
  tx: DbTransaction;
  companyId: string;
  adminUserId: string;
  receiptCode: string;
  receiptDate: string;
  dcLineNo: number;
  itemId: string | null;
  /** Good qty received (rejected qty doesn't return to stock — it goes to NC). */
  qty: number;
}

export async function writeStoreTxnOnDcReceive(
  args: DcReceiveStockTxnArgs,
): Promise<string | null> {
  const { tx, companyId, adminUserId, receiptCode, receiptDate, dcLineNo, itemId, qty } = args;
  if (!itemId) return null; // free-text item, no stock tracking
  if (qty <= 0) return null;

  await tx.execute(sql`SELECT 1 FROM public.items WHERE id = ${itemId}::uuid FOR UPDATE`);

  const balanceRows = (await tx.execute(sql`
    SELECT COALESCE(on_hand_qty, 0)::int AS on_hand
    FROM public.v_item_stock
    WHERE company_id = ${companyId}::uuid AND item_id = ${itemId}::uuid
  `)) as unknown as Array<{ on_hand: number }>;
  const stockBefore = Number(balanceRows[0]?.on_hand ?? 0);
  const stockAfter = stockBefore + qty;

  const inserted = await tx
    .insert(storeTransactions)
    .values({
      companyId,
      txnDate: receiptDate,
      itemId,
      txnType: 'in',
      qty,
      sourceType: 'jw_in',
      sourceRef: `${receiptCode} / ln ${dcLineNo}`,
      stockBefore,
      stockAfter,
      remarks: `JW DC receive · ${qty} pcs`,
      createdBy: adminUserId,
    })
    .returning({ id: storeTransactions.id });

  return inserted[0]?.id ?? null;
}

// Helper for the service: check whether ALL outward lines of a DC are now
// fully reconciled (received + rejected >= original qty per line) and the
// DC status should flip from 'issued' to 'received'. Done in SQL so we
// don't N+1 over lines.
export async function isDcFullyReconciled(
  tx: DbTransaction,
  deliveryChallanId: string,
): Promise<boolean> {
  const rows = (await tx.execute(sql`
    WITH per_line AS (
      SELECT
        dcl.id AS dc_line_id,
        dcl.qty AS sent_qty,
        COALESCE((
          SELECT SUM(drl.received_qty + drl.rejected_qty)
          FROM public.delivery_challan_receipt_lines drl
          INNER JOIN public.delivery_challan_receipts dcr
            ON dcr.id = drl.receipt_id AND dcr.deleted_at IS NULL
          WHERE drl.delivery_challan_line_id = dcl.id
            AND drl.deleted_at IS NULL
        ), 0)::numeric AS total_recv
      FROM public.delivery_challan_lines dcl
      WHERE dcl.delivery_challan_id = ${deliveryChallanId}::uuid
        AND dcl.deleted_at IS NULL
    )
    SELECT COUNT(*) FILTER (WHERE total_recv < sent_qty)::int AS shortfall_count,
           COUNT(*)::int AS total_lines
    FROM per_line
  `)) as unknown as Array<{ shortfall_count: number; total_lines: number }>;
  const r = rows[0];
  if (!r || r.total_lines === 0) return false;
  return r.shortfall_count === 0;
}

// Helper: check whether a DC has any active receipts. Used by cancelDC to
// refuse cancellation once receipts are recorded (cascade for un-doing
// receipts is out of scope for T-059b).
export async function dcHasActiveReceipts(
  tx: DbTransaction,
  deliveryChallanId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: deliveryChallanReceiptLines.id })
    .from(deliveryChallanReceiptLines)
    .innerJoin(
      deliveryChallanLines,
      eq(deliveryChallanLines.id, deliveryChallanReceiptLines.deliveryChallanLineId),
    )
    .where(
      and(
        eq(deliveryChallanLines.deliveryChallanId, deliveryChallanId),
        isNull(deliveryChallanReceiptLines.deletedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
