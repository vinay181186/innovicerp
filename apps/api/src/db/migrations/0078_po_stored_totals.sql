-- ============================================================
-- 0078_po_stored_totals
-- Adds stored computed totals to purchase_orders, mirroring the invoices
-- header (subtotal / gst_amount / grand_total). The PO form shows a Grand
-- Total preview (legacy `_poUpdateTotal()` L25502) that was never persisted;
-- these columns make it durable so lists/detail/reports read one figure.
--
-- Formula (internal roll-up — NOT the legal CGST/SGST/IGST split, which is
-- out of scope per product decision):
--   subtotal     = SUM(qty * rate) over the PO's non-deleted lines
--   tax_amount   = subtotal * (sgst_pct + cgst_pct + igst_pct) / 100
--   total_amount = subtotal + tax_amount
--
-- Additive + idempotent. New columns default to 0; existing POs are then
-- backfilled from their live lines in a single UPDATE ... FROM.
-- ============================================================

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS subtotal numeric(14,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS tax_amount numeric(14,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS total_amount numeric(14,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE public.purchase_orders po
SET
  subtotal = ROUND(ls.line_sum, 2),
  tax_amount = ROUND(ls.line_sum * (po.sgst_pct + po.cgst_pct + po.igst_pct) / 100, 2),
  total_amount = ROUND(ls.line_sum, 2)
    + ROUND(ls.line_sum * (po.sgst_pct + po.cgst_pct + po.igst_pct) / 100, 2)
FROM (
  SELECT purchase_order_id, SUM(qty * rate) AS line_sum
  FROM public.purchase_order_lines
  WHERE deleted_at IS NULL
  GROUP BY purchase_order_id
) ls
WHERE ls.purchase_order_id = po.id;
