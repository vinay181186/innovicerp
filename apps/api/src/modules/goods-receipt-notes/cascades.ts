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
//        Skipped for mid-route OSP returns (ADR-092) — those pieces are WIP
//        owed to a downstream op, and store is credited once by the JC's
//        final QC op instead. See isMidRouteOutsourceReturn below.

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
 * True when this GRN line is the return of an OSP op that is NOT the last op
 * of its Job Card — i.e. the pieces are mid-route WIP, still owed to a
 * downstream op, not finished goods (ADR-092).
 *
 * With no BOM the raw and finished part share one item code, so a job-work
 * return looks identical to a purchase receipt. The only thing that tells them
 * apart is where the outsource op sits in the routing:
 *   - OSP op IS the last op  → the return finishes the JC → credit store.
 *   - OSP op is mid-route    → parts feed the next op → credit nothing here;
 *                              store is credited once, later, by the final QC
 *                              op via qc-stock-cascade.
 * Crediting mid-route returns would double-count (once here, once at final QC).
 *
 * The GRN line is resolved to its jc_op by two paths because
 * `jc_ops.outsource_po_line_id` is only stamped once the outward DC is issued:
 *   1. jc_ops.outsource_po_line_id = the GRN line's purchase_order_line_id
 *   2. GRN → PO → PO.pr_id → purchase_requests.source_jc_op_id
 * A non-OSP GRN (ordinary purchase) resolves to no op and is never blocked.
 */
async function isMidRouteOutsourceReturn(
  tx: DbTransaction,
  grnLineId: string,
): Promise<boolean> {
  const rows = (await tx.execute(sql`
    WITH ln AS (
      SELECT l.purchase_order_line_id, l.goods_receipt_note_id
      FROM public.goods_receipt_note_lines l
      WHERE l.id = ${grnLineId}::uuid
    ),
    op AS (
      SELECT o.job_card_id, o.op_seq
      FROM ln
      JOIN public.jc_ops o
        ON o.outsource_po_line_id = ln.purchase_order_line_id
      WHERE o.deleted_at IS NULL
      UNION
      SELECT o.job_card_id, o.op_seq
      FROM ln
      JOIN public.goods_receipt_notes g ON g.id = ln.goods_receipt_note_id
      JOIN public.purchase_orders po ON po.id = g.purchase_order_id
      JOIN public.purchase_requests pr ON pr.id = po.pr_id
      JOIN public.jc_ops o ON o.id = pr.source_jc_op_id
      WHERE o.deleted_at IS NULL
    )
    SELECT EXISTS (
      SELECT 1 FROM op
      WHERE op.op_seq < (
        SELECT MAX(x.op_seq) FROM public.jc_ops x
        WHERE x.job_card_id = op.job_card_id AND x.deleted_at IS NULL
      )
    ) AS mid_route
  `)) as unknown as Array<{ mid_route: boolean }>;
  return rows[0]?.mid_route === true;
}

/**
 * Credit `qty` accepted pcs to stock via the grn_qc ledger — the single source
 * of truth for QC-accept stock movement. Locks the item row, reads current
 * on-hand, inserts one 'in' store_transaction. No-op when qty ≤ 0 (rejecting
 * everything writes nothing), the line has no resolved item (free-text-only
 * items aren't stock-tracked by design), or the line is a mid-route OSP return
 * (see isMidRouteOutsourceReturn). Callable per-inspect for incremental QC, so
 * multiple partial accepts on one line produce one ledger row each.
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
  // ADR-092: mid-route OSP returns are WIP, not finished goods. Store is
  // credited once, by the JC's final QC op — not here.
  if (await isMidRouteOutsourceReturn(tx, grnLineId)) return;

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
