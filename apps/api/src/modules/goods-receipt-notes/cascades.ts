// GRN cascades (T-036c).
//
// Three transactional helpers fired alongside every GRN write. All accept
// the same `tx` the caller is using (no nested transactions) so the cascade
// effects roll back if the GRN write itself fails.
//
//   1. recalcPoLineReceivedQty(tx, poLineId)
//        Recompute purchase_order_lines.received_qty as the sum of
//        goods_receipt_note_lines.received_qty across non-deleted GRN lines
//        whose purchase_order_line_id = poLineId — EXCLUDING replacement
//        receipts (GRN header carries nc_id) — LESS the return-to-vendor
//        quantity still OPEN (at the vendor) on this line (QC–NC handling §12.2 / §12.6,
//        docs/QC-NC-HANDLING-DESIGN.md §5). See the function for the rule.
//
//   2. recalcPoHeaderStatus(tx, poId)
//        Recompute purchase_orders.status. ADR-222 — a purchase order has only
//        TWO working statuses, and the ladder is two lines long:
//          - ACCEPTED covers the full qty on every line → 'closed'
//          - anything else                              → 'open'
//        ACCEPTED is the ONE definition in lib/po-accepted.ts (Σ GRN
//        qc_accepted_qty + pieces a non-return deviation recovered, capped at
//        the line qty) — NOT received_qty. Only ACCEPTED can close an order.
//        Never downgrades 'cancelled' or 'draft' headers, and never walks a
//        short-closed header back.
//        'partial' and 'qc_pending' are NEVER WRITTEN again. They remain in the
//        enum and in every status LIST (PO_OPEN_STATUSES, the Pending rule's
//        four-status CASE, the report filters) because rows already holding
//        them must keep behaving exactly like 'open'.
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
//        Also skipped when the JC was built by a Production Order (ADR-170)
//        — that JC is credited once, at PO close. See resolveGrnLineJobCardId.

import { eq, sql } from 'drizzle-orm';
import { goodsReceiptNotes, purchaseOrderLines, purchaseOrders } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import { poLineAcceptedRaw } from '../../lib/po-accepted';
import { isProductionOrderLinkedJc } from '../../lib/production-order-link';
import { postStockMove, roundQty } from '../../lib/stock-ledger';

export async function recalcPoLineReceivedQty(
  tx: DbTransaction,
  poLineId: string,
  adminUserId: string,
): Promise<void> {
  // received_qty is RECOMPUTED here, never adjusted in place, so the
  // return-to-vendor accounting the QC–NC document asks for (§12.2 subtract
  // at return, §12.6 add back on clearance) has to live in this one formula --
  // an additive "-= / +=" elsewhere would be overwritten the next time any
  // GRN on the line fired this recalc.
  //
  //   received = Σ received_qty of ORDINARY GRN lines on the line
  //            − Σ (rejected_qty − cleared_qty − failed_qty) of every NC on
  //              one of this line's ops that has had its return challan
  //              issued  — i.e. each NC's OPEN qty, the pieces still at the
  //              vendor
  //
  // Replacement receipts (GRN header nc_id set) are excluded from the first
  // term: the pieces were already counted when they first arrived, and the
  // document says they rejoin the supplied qty only as they CLEAR QC -- which
  // is exactly what the second term does as cleared_qty rises.
  //
  // A replacement piece that FAILS QC is subtracted from the NC's open qty
  // too (failed_qty), NOT left hanging under the original NC: Incoming QC
  // raises a follow-on NC on the replacement GRN line for it, and that
  // follow-on NC is the one that subtracts it -- once ITS challan is issued.
  // Until then the failed piece counts as received, exactly like an in-house
  // rejected piece on an ordinary GRN does (base case: GRN 10, QC 7/3, NC not
  // yet returned -> line 10). Subtracting it under both NCs was the bug that
  // read a line as 7 of 10 after every piece had been accepted.
  //
  // Walk-through (JC IN-JC-26-00033 / IN-JWPO-00005/R1, line qty 10):
  //   T2 single level:   GRN 10 -> QC 7/3, NC-A raised          -> 10
  //                      NC-A challan out (open 3)                ->  7
  //                      replacement 3 back, QC 3 ok, NC-A open 0 -> 10
  //   T3 nested:         NC-A challan out (open 3)                ->  7
  //                      replacement QC 1 ok / 2 reject:
  //                        NC-A open 0 (3-1-2), NC-B (2) not out  -> 10
  //                      NC-B challan out (open 2)                ->  8
  //                      NC-B replacement QC 1 ok / 1 reject:
  //                        NC-B open 0 (2-1-1), NC-C (1) not out  -> 10
  //                      NC-C challan out (open 1)                ->  9
  //                      NC-C replacement cleared, open 0         -> 10
  const result = await tx.execute(sql`
    SELECT
      COALESCE((
        SELECT SUM(grl.received_qty)
        FROM public.goods_receipt_note_lines grl
        JOIN public.goods_receipt_notes grn ON grn.id = grl.goods_receipt_note_id
        WHERE grl.purchase_order_line_id = ${poLineId}::uuid
          AND grl.deleted_at IS NULL
          AND grn.nc_id IS NULL
      ), 0)
      -
      COALESCE((
        SELECT SUM(nc.rejected_qty - nc.cleared_qty - nc.failed_qty)
        FROM public.nc_register nc
        LEFT JOIN public.jc_ops o ON o.id = nc.jc_op_id
        -- ADR-189: a bought-material NC (no job card) reaches its PO line
        -- through the GRN line it was rejected on.
        LEFT JOIN public.goods_receipt_note_lines ngl ON ngl.id = nc.grn_line_id
        WHERE (o.outsource_po_line_id = ${poLineId}::uuid
               OR (nc.job_card_id IS NULL AND ngl.purchase_order_line_id = ${poLineId}::uuid))
          AND nc.disposition = 'return_to_vendor'
          AND nc.delivery_challan_id IS NOT NULL
          AND nc.deleted_at IS NULL
      ), 0) AS total
  `);
  const row = (result as unknown as Array<{ total: unknown }>)[0];
  // 3 places, not a whole number: a PO line may be in KGS / MTR (0172).
  const total = Math.max(0, roundQty(Number(row?.total ?? 0)));
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
    .select({
      id: purchaseOrders.id,
      status: purchaseOrders.status,
      shortClosedAt: purchaseOrders.shortClosedAt,
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, poId))
    .limit(1);
  const header = headerRows[0];
  if (!header) return;
  // ADR-189 — a PO stopped by hand stays stopped: a late QC on its received
  // lines must not reopen it.
  if (header.shortClosedAt !== null) return;
  // Don't touch terminal or draft headers — the open/closed ladder only applies
  // after the PO has been "opened" to vendors.
  if (header.status === 'cancelled' || header.status === 'draft') return;

  // Aggregate snapshot of the PO's lines. ONE fact decides the status, so ONE
  // count is measured:
  //
  //   fully_accepted_count — QC PASSED the full ordered qty (the ONE Accepted
  //                          rule, lib/po-accepted.ts). Only this may close an
  //                          order: a piece booked in and then rejected is not
  //                          work the vendor delivered.
  //
  // ADR-222 removed arrived_count, any_received_count and the whole
  // grn_line_agg CTE (pending_qc_count / grn_line_count). They existed only to
  // tell 'partial' from 'qc_pending', and neither value is written any more —
  // "the goods are here but QC has not finished" is a QC fact that belongs on
  // the GRN, not a purchase-order status. Nothing outside this function ever
  // read them.
  //
  // Consequence, accepted by the owner: pieces rejected and never replaced
  // (scrapped) leave the order OPEN, and the buyer settles it with Close Short
  // and a reason. Nothing here auto-closes and nothing auto-reopens a
  // short-closed order.
  const aggRows = (await tx.execute(sql`
    SELECT
      COUNT(*)::int AS line_count,
      SUM(CASE WHEN ${sql.raw(poLineAcceptedRaw('pol.id'))} >= pol.qty THEN 1 ELSE 0 END)::int
        AS fully_accepted_count
    FROM public.purchase_order_lines pol
    WHERE pol.purchase_order_id = ${poId}::uuid
      AND pol.deleted_at IS NULL
  `)) as unknown as Array<{
    line_count: number;
    fully_accepted_count: number;
  }>;
  const agg = aggRows[0];
  if (!agg) return;

  // The ladder (ADR-222), and it is the whole ladder:
  //   QC passed the full qty on every line : 'closed'
  //   anything else                        : 'open'
  // A PO with no lines at all stays 'open' (line_count > 0 guard) — an empty
  // order has delivered nothing.
  const nextStatus: typeof header.status =
    agg.line_count > 0 && agg.fully_accepted_count === agg.line_count ? 'closed' : 'open';

  if (nextStatus !== header.status) {
    await tx
      .update(purchaseOrders)
      .set({ status: nextStatus, updatedBy: adminUserId })
      .where(eq(purchaseOrders.id, poId));
  }
}

/**
 * The ONE place a GRN line is resolved to the jc_op(s) it returns pieces for.
 * Shared by isMidRouteOutsourceReturn and resolveGrnLineJobCardId so the two
 * can never disagree about which op a receipt belongs to. Yields a CTE named
 * `op` (job_card_id, op_seq); the caller appends its own SELECT.
 *
 * Two paths, because `jc_ops.outsource_po_line_id` is only stamped once the
 * outward DC is issued:
 *   1. jc_ops.outsource_po_line_id = the GRN line's purchase_order_line_id
 *   2. GRN → PO → PO.pr_id → purchase_requests.source_jc_op_id
 * A non-OSP GRN (ordinary purchase) resolves to no op at all.
 */
function grnLineOpsCte(grnLineId: string) {
  return sql`
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
    )`;
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
async function isMidRouteOutsourceReturn(tx: DbTransaction, grnLineId: string): Promise<boolean> {
  const rows = (await tx.execute(sql`
    ${grnLineOpsCte(grnLineId)}
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
 * The Job Card whose op this GRN line returns pieces for, resolved the SAME
 * two ways isMidRouteOutsourceReturn resolves the op (shared CTE above).
 * Null when the line resolves to no jc_op — i.e. a plain purchase GRN — so
 * callers that key a decision on the JC leave ordinary receipts alone.
 *
 * Exported since ADR-182: the short-close guard on the GRN and Incoming QC
 * write paths needs the SAME answer this cascade uses, so both ask this one
 * function rather than each writing its own version of the two-path lookup.
 */
export async function resolveGrnLineJobCardId(
  tx: DbTransaction,
  grnLineId: string,
): Promise<string | null> {
  const rows = (await tx.execute(sql`
    ${grnLineOpsCte(grnLineId)}
    SELECT op.job_card_id
    FROM op
    WHERE op.job_card_id IS NOT NULL
    ORDER BY op.op_seq
    LIMIT 1
  `)) as unknown as Array<{ job_card_id: string | null }>;
  return rows[0]?.job_card_id ?? null;
}

/**
 * True when this GRN was raised by a JW DC Inward (0172: jw_dc_inward.
 * goods_receipt_note_id). A JW DC is a plain store loop — the JW DC Outward
 * took the material OUT of stock ('jw_out') and touched no Job Card op — so its
 * receipt is a stock-in on QC accept, whatever PO line / op the GRN line would
 * otherwise resolve to, and it never feeds the OSP op cascade (outsource
 * returned qty, next-QC mirror, op NC). Job Card work goes out on the OSP DC.
 */
export async function isJwDcReceiptGrn(tx: DbTransaction, grnId: string): Promise<boolean> {
  const rows = (await tx.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM public.jw_dc_inward jdi
      WHERE jdi.goods_receipt_note_id = ${grnId}::uuid AND jdi.deleted_at IS NULL
    ) AS is_jw
  `)) as unknown as Array<{ is_jw: boolean }>;
  return rows[0]?.is_jw === true;
}

/**
 * Credit `qty` accepted pcs to stock via the grn_qc ledger — the single source
 * of truth for QC-accept stock movement. Locks the item row, reads current
 * on-hand, inserts one 'in' store_transaction. No-op when qty ≤ 0 (rejecting
 * everything writes nothing), the line has no resolved item (free-text-only
 * items aren't stock-tracked by design), the line is a mid-route OSP return
 * (see isMidRouteOutsourceReturn), or the line's Job Card was built by a
 * Production Order (ADR-170 — credited at PO close instead). Callable
 * per-inspect for incremental QC, so multiple partial accepts on one line
 * produce one ledger row each.
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
  // A JW DC receipt puts back what its JW DC Outward took out of stock — it is
  // never Job Card WIP, so the two op-based skips below do not apply to it
  // (see isJwDcReceiptGrn). Same stock-in the old 'jw_in' path wrote.
  if (!(await isJwDcReceiptGrn(tx, grnId))) {
    // ADR-092: mid-route OSP returns are WIP, not finished goods. Store is
    // credited once, by the JC's final QC op — not here.
    if (await isMidRouteOutsourceReturn(tx, grnLineId)) return;
    // ADR-170: an OSP return for a Job Card built by a Production Order (or a
    // rework/repair child of one) is credited ONCE, when that Production Order
    // is closed — not here, even when the OSP op is the JC's last op. A line
    // that resolves to no jc_op (a plain purchase GRN) has no JC to be linked
    // to, so it credits exactly as before; purchase_orders.po_type is never
    // consulted.
    const linkedJobCardId = await resolveGrnLineJobCardId(tx, grnLineId);
    if (linkedJobCardId && (await isProductionOrderLinkedJc(tx, linkedJobCardId))) return;
  }

  // Look up the GRN code for the source_ref.
  const grnRows = await tx
    .select({ code: goodsReceiptNotes.code })
    .from(goodsReceiptNotes)
    .where(eq(goodsReceiptNotes.id, grnId))
    .limit(1);
  const grnCode = grnRows[0]?.code ?? grnId;

  await postStockMove(tx, {
    companyId,
    itemId,
    txnType: 'in',
    qty,
    sourceType: 'grn_qc',
    sourceRef: `${grnCode} / ln ${grnLineId.slice(0, 8)}`,
    remarks: `GRN QC Accepted · ${qty} pcs`,
    txnDate: new Date().toISOString().slice(0, 10),
    userId: adminUserId,
    itemCodeText: null,
    guard: 'none',
  });
}
