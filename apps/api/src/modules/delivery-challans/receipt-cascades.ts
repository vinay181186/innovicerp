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
//   3. autoCreateNcFromOutsourceReject(tx, ctx, user)
//        Mirrors `autoCreateNcFromQcReject` from nc-register/cascades.ts.
//        Generates `NC-AUTO-<jcCode>-Op<N>-OS-<HHMMSSmmm>` code, inserts the
//        NC row, emits a CREATE NonConformance audit row. Always uses
//        reason_category='other' (NC enum has no outsource bucket; the
//        detail string and reportedByText='vendor' carry the source).

import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  deliveryChallanLines,
  deliveryChallanReceiptLines,
  items,
  jcOps,
  jobCards,
  ncRegister,
  storeTransactions,
} from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';

export interface ReceiveCascadeArgs {
  tx: DbTransaction;
  companyId: string;
  adminUserId: string;
  receiptCode: string;
  receiptDate: string; // YYYY-MM-DD
  purchaseOrderLineId: string;
  /** Net qty that just landed in this receipt for this po_line (received + rejected). */
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

export interface AutoCreateNcFromOutsourceContext {
  companyId: string;
  jobCardId: string;
  jcCode: string;
  jcOpId: string;
  opSeq: number;
  operationText: string | null;
  rejectedQty: number;
  ncDate: string;
  reportedByText: string | null;
  rejectReason: string;
}

export interface AutoCreateNcResult {
  ncId: string;
  ncCode: string;
}

function generateAutoNcCode(jcCode: string, opSeq: number): string {
  const now = new Date();
  const stamp =
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0') +
    String(now.getMilliseconds()).padStart(3, '0');
  const safeJcCode = jcCode.replace(/[^A-Za-z0-9._-]/g, '_');
  return `NC-AUTO-${safeJcCode}-Op${opSeq}-OS-${stamp}`;
}

export async function autoCreateNcFromOutsourceReject(
  tx: DbTransaction,
  ctx: AutoCreateNcFromOutsourceContext,
  user: AuthContext,
): Promise<AutoCreateNcResult> {
  if (ctx.rejectedQty <= 0) {
    throw new ValidationError('autoCreateNcFromOutsourceReject called with rejectedQty <= 0');
  }

  const jcRows = await tx
    .select({ itemId: jobCards.itemId })
    .from(jobCards)
    .where(and(eq(jobCards.id, ctx.jobCardId), eq(jobCards.companyId, ctx.companyId)))
    .limit(1);
  const jc = jcRows[0];
  if (!jc) throw new NotFoundError(`JC ${ctx.jobCardId} not found for auto-NC`);

  const itemRows = await tx
    .select({ code: items.code })
    .from(items)
    .where(
      and(eq(items.id, jc.itemId), eq(items.companyId, ctx.companyId), isNull(items.deletedAt)),
    )
    .limit(1);
  const itemCode = itemRows[0]?.code ?? '';

  let code = generateAutoNcCode(ctx.jcCode, ctx.opSeq);
  for (let attempt = 0; attempt < 3; attempt++) {
    const dup = await tx
      .select({ id: ncRegister.id })
      .from(ncRegister)
      .where(
        and(
          eq(ncRegister.companyId, ctx.companyId),
          eq(ncRegister.code, code),
          isNull(ncRegister.deletedAt),
        ),
      )
      .limit(1);
    if (dup.length === 0) break;
    const nonce = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    code = `${generateAutoNcCode(ctx.jcCode, ctx.opSeq)}-${nonce}`;
  }

  const reason = `Auto-created from outsource receive on ${ctx.jcCode} Op #${ctx.opSeq}: ${ctx.rejectReason}`;

  const inserted = await tx
    .insert(ncRegister)
    .values({
      companyId: ctx.companyId,
      code,
      ncDate: ctx.ncDate,
      jobCardId: ctx.jobCardId,
      jcOpId: ctx.jcOpId,
      opSeq: ctx.opSeq,
      operationText: ctx.operationText,
      qcOperationText: null,
      itemId: jc.itemId,
      itemCodeText: itemCode,
      itemNameText: null,
      soCodeText: null,
      machineCodeText: null,
      rejectedQty: ctx.rejectedQty.toFixed(2),
      reasonCategory: 'other',
      reason,
      status: 'pending',
      reportedByText: ctx.reportedByText,
      timeLogged: new Date(),
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning();
  const row = inserted[0]!;

  await emitActivityLog(
    tx,
    {
      action: 'CREATE',
      entity: 'NonConformance',
      detail: `${row.code} — ${itemCode || '—'} qty=${row.rejectedQty} (auto from outsource reject)`,
      refId: row.code,
    },
    ctx.companyId,
    user,
  );

  return { ncId: row.id, ncCode: row.code };
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
