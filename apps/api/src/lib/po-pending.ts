// PO Pending / On PO — the ONE definition (ADR-189 #6). Every screen that
// states how much of a PO is still to come reads it from here: Store
// Inventory "On PO", the Item Tracker "On PO", the Open PO Ageing report and
// the PO list / detail "Pending".
//
//   PENDING (a PO line) = qty − ACCEPTED, never below 0, and 0 once the PO
//                         is closed, short-closed or cancelled — nothing more
//                         will come on it.
//   ON PO   (an item)   = Σ PENDING over ISSUED POs: status open / partial /
//                         qc_pending (a draft is not yet an order), EXCEPT
//                         lines that cover a job-card operation (outsourced
//                         work on our own pieces — those show as At Vendor /
//                         in production, and their GRN credits no stock) and
//                         service POs (no goods). A job-work / outsource PO
//                         line with no op behind it comes back into store, so
//                         it IS On PO — the same test the GRN stock credit uses.
//
// ACCEPTED, not received. The two figures a PO line carries mean different
// things: `received_qty` is what physically came in (kept by the GRN cascade),
// ACCEPTED is what the vendor is credited with having delivered good — QC-
// passed pieces PLUS pieces a deviation recovered without a replacement
// (use-as-is / rework), capped at the line qty. That is the ONE definition in
// lib/po-accepted.ts. Pending is measured against ACCEPTED because a piece
// booked in and then failed at QC is not work the vendor delivered, so the
// vendor still owes it.
//
// Because ACCEPTED is capped at the line qty, Pending can never go negative;
// the GREATEST(0, …) below is belt and braces.
//
// Consequence, accepted by the owner: pieces rejected and SCRAPPED (never
// replaced, never used) leave the line standing as pending. The buyer settles
// that with Close Short and a reason, which is what zeroes it. Nothing
// auto-closes.
//
// The TS form (poLinePendingQty, in packages/shared) and the SQL forms below
// are twins — change one, change the other, and keep both reading ACCEPTED.

import { type SQL, sql } from 'drizzle-orm';
import { poLineAcceptedGroupedSql, poLineAcceptedRaw } from './po-accepted';

/** PO statuses whose un-received qty is still coming. */
export const PO_OPEN_STATUSES = ['open', 'partial', 'qc_pending'] as const;

/** Pending qty of one PO line — for code that already holds the numbers. */
export { poLinePendingQty } from '@innovic/shared';

/** Raw SQL for one line's pending qty; `pol` / `po` are the line and header aliases. */
export function poLinePendingRaw(pol: string, po: string): string {
  return `(CASE WHEN ${po}.status IN ('draft', 'open', 'partial', 'qc_pending')
          THEN GREATEST(0, ${pol}.qty - ${poLineAcceptedRaw(`${pol}.id`)}) ELSE 0 END)`;
}

/** The same as a drizzle fragment. */
export function poLinePendingSql(pol: string, po: string): SQL {
  return sql.raw(poLinePendingRaw(pol, po));
}

/** CTE body: item_id, qty = the item's On PO for one company.
 *  Same Pending rule as poLinePendingRaw (qty − ACCEPTED), read through a
 *  grouped LEFT JOIN rather than a correlated sum per line so it stays one
 *  pass over the company's PO lines. */
export function onPoByItemSql(companyId: string): SQL {
  return sql`
    SELECT pol.item_id, SUM(GREATEST(0, pol.qty - COALESCE(acc.accepted, 0)))::numeric AS qty
    FROM public.purchase_order_lines pol
    JOIN public.purchase_orders po ON po.id = pol.purchase_order_id
    LEFT JOIN ${poLineAcceptedGroupedSql(companyId)} acc
      ON acc.purchase_order_line_id = pol.id
    WHERE po.company_id = ${companyId}::uuid
      AND pol.company_id = ${companyId}::uuid
      AND po.deleted_at IS NULL
      AND pol.deleted_at IS NULL
      AND pol.item_id IS NOT NULL
      AND po.status IN ('open', 'partial', 'qc_pending')
      AND po.po_type <> 'service'
      AND pol.source_jc_op_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.jc_op_po_lines jl
                      WHERE jl.purchase_order_line_id = pol.id AND jl.deleted_at IS NULL)
    GROUP BY pol.item_id
  `;
}
