// GRN cascades (T-036c).
//
// Three transactional helpers fired alongside every GRN write. All accept
// the same `tx` the caller is using (no nested transactions) so the cascade
// effects roll back if the GRN write itself fails.
//
//   1. recalcPoLineReceivedQty(tx, poLineId)
//        Recompute purchase_order_lines.received_qty as the sum of
//        goods_receipt_note_lines.received_qty across non-deleted GRN lines
//        whose purchase_order_line_id = poLineId.
//
//   2. recalcPoHeaderStatus(tx, poId)
//        Recompute purchase_orders.status based on aggregate state of its
//        PO lines + their GRN lines:
//          - If any PO line.received_qty < line.qty → 'partial' or 'open'
//            (we keep 'open' if NOTHING received yet; 'partial' if some).
//          - Else (all PO lines fully received): if any GRN line for this PO
//            has qc_status != 'completed' → 'qc_pending'; else → 'closed'.
//        Never downgrades 'cancelled' or 'draft' headers.
//
//   3. writeStoreTxnOnQcAccept(tx, line, prevStatus)
//        Fired when a GRN line transitions from non-completed → 'completed'
//        AND qc_accepted_qty > 0. Writes a store_transactions ledger row
//        of type='in', source_type='grn_qc'. stock_before/after computed
//        from v_item_stock under an items-row FOR UPDATE lock to serialize
//        concurrent QC accepts on the same item.

import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  goodsReceiptNoteLines,
  goodsReceiptNotes,
  purchaseOrderLines,
  purchaseOrders,
  storeTransactions,
} from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';

export async function recalcPoLineReceivedQty(
  tx: DbTransaction,
  poLineId: string,
  adminUserId: string,
): Promise<void> {
  // Sum of received_qty across non-deleted GRN lines for this PO line.
  const result = await tx
    .select({
      total: sql<number>`COALESCE(SUM(${goodsReceiptNoteLines.receivedQty}), 0)::int`,
    })
    .from(goodsReceiptNoteLines)
    .where(
      and(
        eq(goodsReceiptNoteLines.purchaseOrderLineId, poLineId),
        isNull(goodsReceiptNoteLines.deletedAt),
      ),
    );
  const total = Number(result[0]?.total ?? 0);
  await tx
    .update(purchaseOrderLines)
    .set({ receivedQty: total, updatedBy: adminUserId })
    .where(eq(purchaseOrderLines.id, poLineId));
}

export async function recalcPoHeaderStatus(
  tx: DbTransaction,
  poId: string,
  adminUserId: string,
): Promise<void> {
  // Pull the current header to check terminal/draft state.
  const headerRows = await tx
    .select({ id: purchaseOrders.id, status: purchaseOrders.status })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, poId))
    .limit(1);
  const header = headerRows[0];
  if (!header) return;
  // Don't touch terminal or draft headers — the open/partial/qc_pending/closed
  // ladder only applies after the PO has been "opened" to vendors.
  if (header.status === 'cancelled' || header.status === 'draft') return;

  // Aggregate snapshot of the PO's lines + their GRN lines.
  const aggRows = (await tx.execute(sql`
    WITH po_line_agg AS (
      SELECT
        COUNT(*)::int AS line_count,
        SUM(CASE WHEN pol.received_qty >= pol.qty THEN 1 ELSE 0 END)::int AS fully_received_count,
        SUM(CASE WHEN pol.received_qty > 0 THEN 1 ELSE 0 END)::int AS any_received_count
      FROM public.purchase_order_lines pol
      WHERE pol.purchase_order_id = ${poId}::uuid
        AND pol.deleted_at IS NULL
    ),
    grn_line_agg AS (
      SELECT
        COUNT(*)::int AS grn_line_count,
        SUM(CASE WHEN gnl.qc_status != 'completed' THEN 1 ELSE 0 END)::int AS pending_qc_count
      FROM public.goods_receipt_note_lines gnl
      JOIN public.purchase_order_lines pol ON pol.id = gnl.purchase_order_line_id
      WHERE pol.purchase_order_id = ${poId}::uuid
        AND gnl.deleted_at IS NULL
        AND pol.deleted_at IS NULL
    )
    SELECT
      pla.line_count,
      pla.fully_received_count,
      pla.any_received_count,
      gla.grn_line_count,
      gla.pending_qc_count
    FROM po_line_agg pla, grn_line_agg gla
  `)) as unknown as Array<{
    line_count: number;
    fully_received_count: number;
    any_received_count: number;
    grn_line_count: number;
    pending_qc_count: number;
  }>;
  const agg = aggRows[0];
  if (!agg) return;

  let nextStatus: typeof header.status;
  if (agg.line_count > 0 && agg.fully_received_count === agg.line_count) {
    nextStatus = agg.pending_qc_count === 0 ? 'closed' : 'qc_pending';
  } else if (agg.any_received_count > 0) {
    nextStatus = 'partial';
  } else {
    nextStatus = 'open';
  }

  if (nextStatus !== header.status) {
    await tx
      .update(purchaseOrders)
      .set({ status: nextStatus, updatedBy: adminUserId })
      .where(eq(purchaseOrders.id, poId));
  }
}

interface QcAcceptCascadeArgs {
  tx: DbTransaction;
  companyId: string;
  adminUserId: string;
  grnId: string;
  grnLineId: string;
  itemId: string | null;
  qcAcceptedQty: number;
  prevQcStatus: 'pending' | 'in_progress' | 'completed' | undefined;
  nextQcStatus: 'pending' | 'in_progress' | 'completed';
}

export async function writeStoreTxnOnQcAccept(args: QcAcceptCascadeArgs): Promise<void> {
  const { tx, companyId, adminUserId, grnId, grnLineId, itemId, qcAcceptedQty, prevQcStatus, nextQcStatus } =
    args;
  // Whole-GRN QC merge path: credit only on the non-completed → completed
  // transition, with the full accepted qty. (The Incoming QC Register credits
  // incrementally per inspect via creditGrnQcStock directly.)
  if (nextQcStatus !== 'completed') return;
  if (prevQcStatus === 'completed') return;
  await creditGrnQcStock({ tx, companyId, adminUserId, grnId, grnLineId, itemId, qty: qcAcceptedQty });
}

/**
 * Credit `qty` accepted pcs to stock via the grn_qc ledger — the single source
 * of truth for QC-accept stock movement. Locks the item row, reads current
 * on-hand, inserts one 'in' store_transaction. No-op when qty ≤ 0 (rejecting
 * everything writes nothing) or the line has no resolved item (free-text-only
 * items aren't stock-tracked by design). Callable per-inspect for incremental
 * QC, so multiple partial accepts on one line produce one ledger row each.
 */
export async function creditGrnQcStock(args: {
  tx: DbTransaction;
  companyId: string;
  adminUserId: string;
  grnId: string;
  grnLineId: string;
  itemId: string | null;
  qty: number;
}): Promise<void> {
  const { tx, companyId, adminUserId, grnId, grnLineId, itemId, qty } = args;
  if (qty <= 0) return;
  if (!itemId) return;

  // Lock the items row to serialize concurrent QC accepts on the same item.
  await tx.execute(sql`SELECT 1 FROM public.items WHERE id = ${itemId}::uuid FOR UPDATE`);

  // Read current on-hand from v_item_stock; default to 0 when no prior txns.
  const balanceRows = (await tx.execute(sql`
    SELECT COALESCE(on_hand_qty, 0)::int AS on_hand
    FROM public.v_item_stock
    WHERE company_id = ${companyId}::uuid AND item_id = ${itemId}::uuid
  `)) as unknown as Array<{ on_hand: number }>;
  const stockBefore = Number(balanceRows[0]?.on_hand ?? 0);
  const stockAfter = stockBefore + qty;

  // Look up the GRN code for the source_ref.
  const grnRows = await tx
    .select({ code: goodsReceiptNotes.code })
    .from(goodsReceiptNotes)
    .where(eq(goodsReceiptNotes.id, grnId))
    .limit(1);
  const grnCode = grnRows[0]?.code ?? grnId;

  await tx.insert(storeTransactions).values({
    companyId,
    txnDate: new Date().toISOString().slice(0, 10),
    itemId,
    txnType: 'in',
    qty,
    sourceType: 'grn_qc',
    sourceRef: `${grnCode} / ln ${grnLineId.slice(0, 8)}`,
    stockBefore,
    stockAfter,
    remarks: `GRN QC accept · ${qty} pcs`,
    createdBy: adminUserId,
  });
}
