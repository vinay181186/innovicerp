// ACCEPTED against a PO line — the ONE figure (§20.1 one number, one writer).
//
// A purchase order line carries TWO receipt figures and they mean different
// things:
//
//   RECEIVED (purchase_order_lines.received_qty, kept by the GRN cascade
//             recalcPoLineReceivedQty) = what physically came in, less the
//             pieces currently back at the vendor on a return challan.
//
//   ACCEPTED (here, computed, never stored) = what the vendor is credited
//             with having delivered good — QC-passed pieces PLUS pieces a
//             deviation decision recovered without the vendor replacing them.
//
//   ACCEPTED (a PO line) =
//         Σ qc_accepted_qty of the line's live GRN lines on live GRN headers
//       + Σ cleared_qty of the line's live NCs whose disposition is NOT
//         return_to_vendor
//       capped at the line's ordered qty.
//
// Pending is measured against ACCEPTED, not Received (lib/po-pending.ts): a
// piece booked in and then failed at QC is not work the vendor delivered, so
// the line must still read as owed.
//
// --- term 1: QC-accepted GRN lines ---------------------------------------
// Note the deliberate difference from RECEIVED: this does NOT filter
// `g.nc_id IS NULL`. A replacement receipt's QC-accepted quantity is exactly
// how the returned pieces rejoin the figure, so replacement GRN lines MUST
// count here. (RECEIVED excludes them because those pieces were already
// counted when they first arrived — see recalcPoLineReceivedQty.)
//
// --- term 2: pieces a deviation recovered WITHOUT a replacement ----------
// Incoming QC can reject pieces and the business can still decide to USE them
// (use_as_is, a concession) or to REWORK them here rather than send them back.
// Both close the NC by raising cleared_qty (nc-register/cascades.ts for
// use_as_is, nc-register/recovery.ts creditRecovery for rework), the operation
// proceeds with the full quantity and the vendor is paid — but qc_accepted_qty
// never rises, because no second receipt ever happens. Without this term the
// line would read short for ever and the item would carry phantom pieces in
// "On PO".
//
// `return_to_vendor` MUST be excluded or it double-counts: an RTV's recovery
// arrives as the REPLACEMENT GRN line's qc_accepted_qty, which term 1 already
// picks up (and the RTV NC's own cleared_qty rises at the same moment — see
// recalcPoLineReceivedQty's second term, which is what the RTV NC's cleared_qty
// is there for).
//
// An NC reaches its PO line exactly the way recalcPoLineReceivedQty's second
// term reaches it — `jc_ops.outsource_po_line_id = <line>`, or (for a
// bought-material NC with no job card) through the GRN line it was rejected
// on. The join shape is copied so the two formulas can never disagree about
// which NC belongs to which line.
//
// Cases, reasoned through:
//   - scrap: cleared_qty stays 0, so the line stays short — Close Short with a
//     reason is what settles it (the owner's decision; nothing auto-closes).
//   - use_as_is / rework: cleared_qty rises, the line reaches its full qty and
//     the order closes, which is what actually happened on the shop floor.
//   - return_to_vendor: excluded here; those pieces rejoin through the
//     replacement receipt's accepted qty (term 1).
//   - IN-JWPO-00008/R1 on TEST, line qty 100: IN-GRN-00014 accepted 70,
//     IN-GRN-00015 accepted 0 (QC pending), NC-00007 is return_to_vendor and so
//     contributes nothing → accepted 70, pending 30. When IN-GRN-00015's QC
//     passes 30 → accepted 100, pending 0.
//
// --- the cap --------------------------------------------------------------
// ACCEPTED is capped (LEAST) at the line's ordered qty so no screen can ever
// print Accepted greater than Qty. A rework loop can otherwise over-count: GRN
// 1 accepts 10 of 10, an NC is raised later, the return drops RECEIVED to 7 and
// the replacement GRN accepts 3 → 13 on a line of 10. Capping inside the ONE
// definition keeps every reader sane, and Pending (qty − ACCEPTED, floored at
// 0 in lib/po-pending.ts) stays 0 instead of going negative.
//
// Quantities are decimal (KGS / MTR, 3 places — 0172), so the sums are
// numeric — never ::int.
//
// The conditions live in the constants below and are used by the scalar form,
// the drizzle form and the grouped form alike, so the three can never
// disagree.

import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

const ACCEPTED_FROM = `FROM public.goods_receipt_note_lines gl
      JOIN public.goods_receipt_notes g ON g.id = gl.goods_receipt_note_id`;
const ACCEPTED_WHERE = `gl.deleted_at IS NULL AND g.deleted_at IS NULL`;

// Term 2 — the NC side. Same joins as recalcPoLineReceivedQty's second term.
const RECOVERED_FROM = `FROM public.nc_register nc
      LEFT JOIN public.jc_ops o ON o.id = nc.jc_op_id
      LEFT JOIN public.goods_receipt_note_lines ngl ON ngl.id = nc.grn_line_id`;
// `<> 'return_to_vendor'` (not IS DISTINCT FROM): an NC with no disposition
// decided yet has cleared_qty 0, and only a decided, non-return disposition
// recovers pieces without a replacement receipt.
const RECOVERED_WHERE = `nc.disposition <> 'return_to_vendor' AND nc.deleted_at IS NULL`;
/** The NC → PO line test, copied from recalcPoLineReceivedQty. */
const recoveredOnLine = (polId: string): string =>
  `(o.outsource_po_line_id = ${polId}
         OR (nc.job_card_id IS NULL AND ngl.purchase_order_line_id = ${polId}))`;
/** The line's ordered qty, for the cap. LEAST ignores a NULL, so a line that
 *  has somehow gone missing leaves the sum uncapped rather than NULL. */
const lineQty = (polId: string): string =>
  `(SELECT pq.qty FROM public.purchase_order_lines pq WHERE pq.id = ${polId})`;

/** Scalar SQL for one line's ACCEPTED; `polId` is a SQL expression for the PO
 *  line id (e.g. a raw alias like `pol.id`). Already COALESCEd to 0. */
export function poLineAcceptedRaw(polId: string): string {
  return `LEAST(
      COALESCE((SELECT SUM(gl.qc_accepted_qty)
      ${ACCEPTED_FROM}
      WHERE gl.purchase_order_line_id = ${polId}
        AND ${ACCEPTED_WHERE}), 0)
      + COALESCE((SELECT SUM(nc.cleared_qty)
      ${RECOVERED_FROM}
      WHERE ${recoveredOnLine(polId)}
        AND ${RECOVERED_WHERE}), 0),
      ${lineQty(polId)})`;
}

/** The same as a drizzle fragment, so a drizzle `.select()` can pass a real
 *  column reference instead of a hand-written table alias. */
export function poLineAcceptedSql(polId: SQLWrapper): SQL {
  return sql`LEAST(
      COALESCE((SELECT SUM(gl.qc_accepted_qty)
      ${sql.raw(ACCEPTED_FROM)}
      WHERE gl.purchase_order_line_id = ${polId}
        AND ${sql.raw(ACCEPTED_WHERE)}), 0)
      + COALESCE((SELECT SUM(nc.cleared_qty)
      ${sql.raw(RECOVERED_FROM)}
      WHERE (o.outsource_po_line_id = ${polId}
             OR (nc.job_card_id IS NULL AND ngl.purchase_order_line_id = ${polId}))
        AND ${sql.raw(RECOVERED_WHERE)}), 0),
      (SELECT pq.qty FROM public.purchase_order_lines pq WHERE pq.id = ${polId}))`;
}

/**
 * ACCEPTED for every PO line of a company in ONE pass — a derived table with
 * columns (purchase_order_line_id, accepted). Lines with neither a GRN line
 * nor a recovered NC are absent, so read it through a LEFT JOIN + COALESCE.
 * Use it in list queries instead of a correlated poLineAcceptedRaw per row —
 * the same shape poLineSentGroupedSql has in lib/po-line-sent.ts.
 *
 * The two terms are UNION ALL'd and summed per line. They can never
 * double-count the same NC: the first NC branch needs a jc_op behind the line,
 * the second needs `job_card_id IS NULL` (so no op at all).
 *
 * Aliases are `pl` / `src`, never `pol`, so the derived table cannot shadow a
 * caller's own `pol`.
 */
export function poLineAcceptedGroupedSql(companyId: string): SQL {
  return sql`(
    SELECT src.purchase_order_line_id,
           LEAST(SUM(src.qty), MIN(pl.qty)) AS accepted
    FROM (
      SELECT gl.purchase_order_line_id, gl.qc_accepted_qty AS qty
      ${sql.raw(ACCEPTED_FROM)}
      WHERE gl.company_id = ${companyId}::uuid
        AND gl.purchase_order_line_id IS NOT NULL
        AND ${sql.raw(ACCEPTED_WHERE)}
      UNION ALL
      SELECT o.outsource_po_line_id AS purchase_order_line_id, nc.cleared_qty AS qty
      FROM public.nc_register nc
      JOIN public.jc_ops o ON o.id = nc.jc_op_id
      WHERE nc.company_id = ${companyId}::uuid
        AND o.outsource_po_line_id IS NOT NULL
        AND ${sql.raw(RECOVERED_WHERE)}
      UNION ALL
      SELECT ngl.purchase_order_line_id, nc.cleared_qty AS qty
      FROM public.nc_register nc
      JOIN public.goods_receipt_note_lines ngl ON ngl.id = nc.grn_line_id
      WHERE nc.company_id = ${companyId}::uuid
        AND nc.job_card_id IS NULL
        AND ngl.purchase_order_line_id IS NOT NULL
        AND ${sql.raw(RECOVERED_WHERE)}
    ) src
    JOIN public.purchase_order_lines pl ON pl.id = src.purchase_order_line_id
    GROUP BY src.purchase_order_line_id
  )`;
}
