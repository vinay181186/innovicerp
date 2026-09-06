-- ============================================================
-- 0113_po_lines_missing_sales_order
--
-- Data repair. Fills purchase_order_lines.source_so_line_id where it is NULL
-- but the sales order is knowable from the line's own provenance.
--
-- Why these rows exist. A PO raised from a Purchase Request must copy the PR's
-- source_so_line_id onto its line; that is how every screen answers "which SO
-- is this PO for" — the OSP challan list and detail resolve the SO by walking
-- delivery_challans → purchase_order_lines.source_so_line_id → sales_orders,
-- and PO detail reads it off the first line that carries one.
--
-- The +New PO screen did not copy it. Fixed in commit 59f26b0 at 17:24 IST on
-- 2026-09-05, but the rows written before that were never repaired, so:
--
--   IN-PO-00004 (11:44) IN-PO-00005 (15:43) IN-PO-00006 (16:00)
--   IN-PO-00007 (16:39) IN-PO-00008 (17:03, two lines)
--
-- …all show a blank SO, and so does every challan raised against them —
-- IN-DC-00003 through IN-DC-00008. The three POs created directly (IN-PO-00001
-- /2/3) were always stamped and are untouched by this.
--
-- The SO was never lost, only unrecorded on this row. Two ways back to it,
-- tried in order:
--
--   1. the Purchase Request the line came from (source_pr_id → PR's own
--      source_so_line_id) — the value the PO should have copied in the first
--      place, so this is a repair, not a guess;
--   2. the job-card operation being outsourced (source_jc_op_id → jc_ops →
--      job_cards.source_so_line_id) — the same answer by a different road,
--      for a line whose PR link is missing.
--
-- Blanks only: `WHERE source_so_line_id IS NULL` means nothing already set can
-- be overwritten, and re-running changes nothing. Deleted rows are skipped at
-- every hop, and the SO line must still exist, so no dangling FK is created.
-- Nothing else on the row is touched — not qty, not rate, not received_qty.
-- updated_at is deliberately left alone: this corrects what the row always
-- meant rather than recording a change the user made.
--
-- The two UPDATEs are separated by a `--> statement-breakpoint` marker because
-- that -- not the semicolon -- is what src/db/apply-sql.ts splits on. Without
-- it the whole file is handed to the driver as a single string, which is how
-- the first attempt at this migration ran and changed nothing.
-- ============================================================

-- 1) Through the purchase request.
UPDATE public.purchase_order_lines pol
   SET source_so_line_id = pr.source_so_line_id
  FROM public.purchase_requests pr
       JOIN public.sales_order_lines sol
         ON sol.id = pr.source_so_line_id AND sol.deleted_at IS NULL
 WHERE pol.source_pr_id = pr.id
   AND pol.source_so_line_id IS NULL
   AND pol.deleted_at IS NULL
   AND pr.deleted_at IS NULL;

--> statement-breakpoint

-- 2) Through the job-card operation, for anything step 1 could not reach.
UPDATE public.purchase_order_lines pol
   SET source_so_line_id = jc.source_so_line_id
  FROM public.jc_ops o
       JOIN public.job_cards jc
         ON jc.id = o.job_card_id AND jc.deleted_at IS NULL
       JOIN public.sales_order_lines sol
         ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
 WHERE pol.source_jc_op_id = o.id
   AND pol.source_so_line_id IS NULL
   AND pol.deleted_at IS NULL
   AND o.deleted_at IS NULL;
