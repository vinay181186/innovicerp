-- ============================================================
-- 0171_invoice_tax_type_and_payment_tds
--
-- 1. An SO invoice stored one GST % and never said whether the supply
--    is intra-state (SGST + CGST) or inter-state (IGST). Adds the same
--    tax_type fact the JW invoice has (0148), same two codes.
--      invoices.tax_type  text NULL  'sgst_cgst' | 'igst'
--    NULL = invoice raised before this migration: it prints as before.
-- 2. Customers deduct TDS (or pay short) and the invoice stayed
--    'partial' forever. A payment row now carries the amount deducted,
--    which counts toward settling the invoice.
--      invoice_payments.tds_amount  numeric(14,2) NOT NULL DEFAULT 0
--      invoices.total_tds           numeric(14,2) NOT NULL DEFAULT 0
--    Outstanding Amount = grand_total - total_paid - total_tds.
--    Existing rows get 0, so no figure changes.
--
-- ROLLBACK: DROP COLUMN invoices.tax_type, invoices.total_tds,
--           invoice_payments.tds_amount.
-- Idempotent. Apply to BOTH the test and the production database.
-- ============================================================

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS tax_type text;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_tax_type_check'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_tax_type_check
      CHECK (tax_type IS NULL OR tax_type IN ('sgst_cgst', 'igst'));
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS total_tds numeric(14, 2) NOT NULL DEFAULT 0;
--> statement-breakpoint

ALTER TABLE public.invoice_payments
  ADD COLUMN IF NOT EXISTS tds_amount numeric(14, 2) NOT NULL DEFAULT 0;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.invoice_payments'::regclass
      AND conname = 'invoice_payments_tds_amount_check'
  ) THEN
    ALTER TABLE public.invoice_payments
      ADD CONSTRAINT invoice_payments_tds_amount_check
      CHECK (tds_amount >= 0);
  END IF;
END $$;
