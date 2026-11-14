import { sql, type SQL } from 'drizzle-orm';

// Drawing Rev register (owner 2026-10-31): plans, Production Orders and Job
// Cards STORE item_revision_id. Every read that shows a document's Rev reads it
// through here — the document's own Rev first, the SO / JWSO line text only as
// the fallback for documents made before the register (a split line can have
// JC-1 at ABC/1 and JC-2 at ABC/2, so the line text alone is not the answer).

/** The Rev text of an item_revision_id column/expression already in the query
 *  (scalar primary-key lookup; null when the document names no Rev). */
export function drawingRevOf(itemRevisionId: unknown): SQL<string | null> {
  return sql<
    string | null
  >`(SELECT ir.rev FROM public.item_revisions ir WHERE ir.id = ${itemRevisionId})`;
}

/** ADR-289 — the Drawing Rev a challan line is MADE with, as a scalar for the
 *  insert itself (no extra round trip). The Job Card the DC line itself names
 *  (an NC return) first; else the Rev of the Job Cards whose OSP ops the PO
 *  line serves (source_jc_op_id / outsource_po_line_id) — but only when those
 *  cards are all on ONE Rev: a PO line serving cards on two Revs names none,
 *  so it falls back to the SO line's and then the JWSO line's Rev at this
 *  moment (again only when one). Every hop insists the document is for the
 *  SAME item as the line, so a bar of raw material never wears the part's
 *  Rev. NULL when nothing names one. */
export function dcLineRevIdSql(
  itemId: string | null,
  purchaseOrderLineId: string | null,
  jobCardId: string | null = null,
): SQL<string | null> {
  if (!itemId) return sql<string | null>`NULL::uuid`;
  const item = sql`${itemId}::uuid`;
  const pol = purchaseOrderLineId ? sql`${purchaseOrderLineId}::uuid` : sql`NULL::uuid`;
  const jc = jobCardId ? sql`${jobCardId}::uuid` : sql`NULL::uuid`;
  // The PO line's Job Cards for this item (an op linked either way).
  const polCards = sql`
       FROM public.purchase_order_lines p
       JOIN public.jc_ops o ON (o.id = p.source_jc_op_id OR o.outsource_po_line_id = p.id)
        AND o.deleted_at IS NULL
       JOIN public.job_cards j ON j.id = o.job_card_id AND j.deleted_at IS NULL`;
  return sql<string | null>`COALESCE(
    (SELECT j.item_revision_id FROM public.job_cards j
      WHERE j.id = ${jc} AND j.item_id = ${item}),
    (SELECT CASE WHEN COUNT(*) FILTER (WHERE j.item_revision_id IS NULL) = 0
                  AND COUNT(DISTINCT j.item_revision_id) = 1
                 THEN MIN(j.item_revision_id::text)::uuid END
       ${polCards}
      WHERE p.id = ${pol} AND j.item_id = ${item}),
    (SELECT s.item_revision_id
       FROM public.purchase_order_lines p
       JOIN public.sales_order_lines s ON s.id = p.source_so_line_id
      WHERE p.id = ${pol} AND s.item_id = ${item}),
    (SELECT CASE WHEN COUNT(*) FILTER (WHERE s.item_revision_id IS NULL) = 0
                  AND COUNT(DISTINCT s.item_revision_id) = 1
                 THEN MIN(s.item_revision_id::text)::uuid END
       ${polCards}
       JOIN public.sales_order_lines s ON s.id = j.source_so_line_id
      WHERE p.id = ${pol} AND s.item_id = ${item}),
    (SELECT CASE WHEN COUNT(*) FILTER (WHERE w.item_revision_id IS NULL) = 0
                  AND COUNT(DISTINCT w.item_revision_id) = 1
                 THEN MIN(w.item_revision_id::text)::uuid END
       ${polCards}
       JOIN public.job_work_order_lines w ON w.id = j.source_jw_line_id
      WHERE p.id = ${pol} AND w.item_id = ${item})
  )`;
}
