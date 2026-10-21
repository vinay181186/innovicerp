-- ============================================================
-- 0214_invoice_round_off  (ADR-248)
--
-- Tax Invoices and JW Invoices now round their total to the nearest rupee
-- with a Round-off line (same rule as SO / JWSO / PO, computeGstTotals).
--   invoices.round_off      numeric(14,2) NULL
--   jw_invoices.round_off   numeric(14,2) NULL
-- NULL = an invoice issued before this migration: it keeps printing exactly
-- as issued (no Round-off line, the old SGST/CGST split). New invoices store
-- the round-off and a rounded grand_total / total_amount. No backfill — an
-- issued invoice is never re-figured.
--
-- ROLLBACK:
--   ALTER TABLE public.invoices DROP COLUMN round_off;
--   ALTER TABLE public.jw_invoices DROP COLUMN round_off;
-- Idempotent. Additive only. Apply to BOTH the test and the production database.
-- ============================================================

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS round_off numeric(14, 2);
--> statement-breakpoint

ALTER TABLE public.jw_invoices ADD COLUMN IF NOT EXISTS round_off numeric(14, 2);
