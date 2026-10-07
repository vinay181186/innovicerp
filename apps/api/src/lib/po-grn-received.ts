// GRN RECEIVED against a PO line — the ONE figure (ADR-222, §20.1 one number,
// one writer).
//
// A purchase order line now carries THREE receipt figures. They are three
// different facts and no screen may swap one for another:
//
//   GRN RECEIVED (here, computed, never stored) = everything the line's goods
//             receipt notes actually BOOKED IN, replacement receipts included.
//             It only ever rises, and it MAY EXCEED the ordered qty: a piece
//             rejected, returned to the vendor and replaced arrived twice, so
//             it was booked twice. This is the honest "what came through the
//             gate" total.
//
//   RECEIVED (purchase_order_lines.received_qty, kept by the GRN cascade
//             recalcPoLineReceivedQty) = what is IN HAND now — the ordinary
//             GRN total less the pieces currently back at the vendor on a
//             return challan. This is the figure the receivable cap, the
//             over-receipt guards and Store's "On PO" read, and it is NOT
//             changed by this file.
//
//   ACCEPTED (lib/po-accepted.ts) = what the vendor is credited with having
//             delivered good — QC-passed pieces plus pieces a deviation
//             recovered without a replacement, capped at the ordered qty.
//             Pending is measured against this one.
//
//   GRN RECEIVED (a PO line) =
//         COALESCE(SUM(gl.received_qty), 0)
//         over the line's live GRN lines on live GRN headers
//
// Two deliberate differences from recalcPoLineReceivedQty, and both are the
// whole point of this figure:
//
//   - NO `g.nc_id IS NULL` filter. A replacement receipt is a real arrival at
//     the gate and is counted here. (RECEIVED excludes it because those pieces
//     were already counted when they first arrived, so counting them twice
//     would overstate what is in hand.)
//
//   - NO subtraction of the pieces sitting at the vendor on a return challan,
//     and NO cap at the ordered qty. Going out again does not un-book the
//     arrival, and a line of 100 whose 20 rejected pieces were returned and
//     replaced legitimately reads 120 here.
//
// Worked example (IN-JWPO-00010/R1, line qty 100): GRN-00016 books 100, QC
// accepts 80 and rejects 20, the 20 are returned to the vendor on a challan.
//   GRN RECEIVED 100 (the 100 that arrived)
//   RECEIVED      80 (100 booked − 20 back at the vendor)
//   ACCEPTED      80 (QC passed 80)
//   PENDING       20 (100 − 80)
// When the replacement 20 arrive and pass QC: GRN RECEIVED 120, RECEIVED 100,
// ACCEPTED 100, PENDING 0.
//
// Quantities are decimal (KGS / MTR, 3 places — 0172), so the sums are
// numeric — never ::int.
//
// The conditions live in the constants below and are used by the scalar form,
// the drizzle form and the grouped form alike, so the three can never
// disagree — the same three-form shape as lib/po-accepted.ts.

import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

const GRN_RECEIVED_FROM = `FROM public.goods_receipt_note_lines gl
      JOIN public.goods_receipt_notes g ON g.id = gl.goods_receipt_note_id`;
const GRN_RECEIVED_WHERE = `gl.deleted_at IS NULL AND g.deleted_at IS NULL`;

/** Scalar SQL for one line's GRN RECEIVED; `polId` is a SQL expression for the
 *  PO line id (e.g. a raw alias like `pol.id`). Already COALESCEd to 0. */
export function poLineGrnReceivedRaw(polId: string): string {
  return `COALESCE((SELECT SUM(gl.received_qty)
      ${GRN_RECEIVED_FROM}
      WHERE gl.purchase_order_line_id = ${polId}
        AND ${GRN_RECEIVED_WHERE}), 0)`;
}

/** The same as a drizzle fragment, so a drizzle `.select()` can pass a real
 *  column reference instead of a hand-written table alias. */
export function poLineGrnReceivedSql(polId: SQLWrapper): SQL {
  return sql`COALESCE((SELECT SUM(gl.received_qty)
      ${sql.raw(GRN_RECEIVED_FROM)}
      WHERE gl.purchase_order_line_id = ${polId}
        AND ${sql.raw(GRN_RECEIVED_WHERE)}), 0)`;
}

/**
 * GRN RECEIVED for every PO line of a company in ONE pass — a derived table
 * with columns (purchase_order_line_id, grn_received). Lines with no GRN line
 * at all are absent, so read it through a LEFT JOIN + COALESCE. Use it in list
 * queries instead of a correlated poLineGrnReceivedRaw per row — the same
 * shape poLineAcceptedGroupedSql has in lib/po-accepted.ts.
 *
 * The alias is `gl` / `g`, never `pol`, so the derived table cannot shadow a
 * caller's own `pol`.
 */
export function poLineGrnReceivedGroupedSql(companyId: string): SQL {
  return sql`(
    SELECT gl.purchase_order_line_id,
           SUM(gl.received_qty) AS grn_received
    ${sql.raw(GRN_RECEIVED_FROM)}
    WHERE gl.company_id = ${companyId}::uuid
      AND gl.purchase_order_line_id IS NOT NULL
      AND ${sql.raw(GRN_RECEIVED_WHERE)}
    GROUP BY gl.purchase_order_line_id
  )`;
}
