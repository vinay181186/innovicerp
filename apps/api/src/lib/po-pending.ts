// PO Pending / On PO — the ONE definition (ADR-189 #6). Every screen that
// states how much of a PO is still to come reads it from here: Store
// Inventory "On PO", the Item Tracker "On PO", the Open PO Ageing report and
// the PO list / detail "Pending".
//
//   PENDING (a PO line) = qty − received_qty, never below 0, and 0 once the PO
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
// received_qty is the stored line figure the GRN cascade keeps (receipts
// minus pieces returned to the vendor), not a fresh Σ of GRN lines, so a
// vendor that owes a returned piece again shows it as pending again.

import { type SQL, sql } from 'drizzle-orm';

/** PO statuses whose un-received qty is still coming. */
export const PO_OPEN_STATUSES = ['open', 'partial', 'qc_pending'] as const;

/** Pending qty of one PO line — for code that already holds the numbers. */
export { poLinePendingQty } from '@innovic/shared';

/** Raw SQL for one line's pending qty; `pol` / `po` are the line and header aliases. */
export function poLinePendingRaw(pol: string, po: string): string {
  return `(CASE WHEN ${po}.status IN ('draft', 'open', 'partial', 'qc_pending')
          THEN GREATEST(0, ${pol}.qty - COALESCE(${pol}.received_qty, 0)) ELSE 0 END)`;
}

/** The same as a drizzle fragment. */
export function poLinePendingSql(pol: string, po: string): SQL {
  return sql.raw(poLinePendingRaw(pol, po));
}

/** CTE body: item_id, qty = the item's On PO for one company. */
export function onPoByItemSql(companyId: string): SQL {
  return sql`
    SELECT pol.item_id, SUM(GREATEST(0, pol.qty - COALESCE(pol.received_qty, 0)))::int AS qty
    FROM public.purchase_order_lines pol
    JOIN public.purchase_orders po ON po.id = pol.purchase_order_id
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
