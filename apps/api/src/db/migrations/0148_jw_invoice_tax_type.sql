-- ============================================================
-- 0148_jw_invoice_tax_type
--
-- A JW invoice printed one "GST @ 18%" row: jw_invoices had a single
-- gst_percent and no way to say whether the supply is intra-state (SGST +
-- CGST, half each) or inter-state (IGST). This adds that one fact.
--
-- Change, and nothing else:
--   jw_invoices.tax_type  text NULL
--     'sgst_cgst' | 'igst' -- the same codes purchase_orders.tax_type uses.
--
-- NULL (every row before this migration) prints the old single GST row.
-- Totals are untouched: the total GST % and amounts stay where they are; the
-- tax type only decides how the print splits them.
--
-- ROLLBACK: ALTER TABLE public.jw_invoices DROP COLUMN tax_type;
-- Idempotent. Apply to BOTH the test and the production database.
-- ============================================================

ALTER TABLE public.jw_invoices ADD COLUMN IF NOT EXISTS tax_type text;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.jw_invoices'::regclass
      AND conname = 'jw_invoices_tax_type_check'
  ) THEN
    ALTER TABLE public.jw_invoices
      ADD CONSTRAINT jw_invoices_tax_type_check
      CHECK (tax_type IS NULL OR tax_type IN ('sgst_cgst', 'igst'));
  END IF;
END $$;
