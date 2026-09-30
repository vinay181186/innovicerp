-- ============================================================
-- 0186_legal_copy_place_of_supply.sql  (fix wave 3, area FG — plan v3 Steps 3 + 4)
--
-- Owner decisions D2 (Place of Supply from the customer's State, never a
-- guessed "Gujarat"), D6 (payment terms from the master) and D7 (legal papers
-- keep their own copy of the customer's details — ERPNext "address_display").
--
-- 1. Legal copy of the customer on the four customer-facing legal papers.
--    Filled when the paper is made; the print reads THIS copy, so a later
--    change to the customer master never changes a paper already issued.
--      invoices            + client_address_line1, client_city, client_state,
--                            client_state_code, client_pincode, place_of_supply,
--                            client_copy_at
--                            (client_name_text / client_code_text /
--                             client_gst_text already exist since 0050)
--      jw_invoices         + client_name_text, client_gst_text, the same five
--                            address columns, place_of_supply, client_copy_at
--      jw_return_challans  + (same as jw_invoices)
--      customer_dispatches + client_gst_text, the five address columns,
--                            place_of_supply, client_copy_at
--                            (the name copy is the existing customer_text)
--    client_copy_at = when the copy was taken. NULL = no copy (a row written by
--    code older than this release) → the print falls back to the live master.
--    place_of_supply = GST State Code (2 digits) the paper was billed / shipped
--    to: the customer's State Code, else its GSTIN's first two digits,
--    Overseas → '96'. NULL = unknown at the time (warn mode).
--
-- 2. JW Invoice payment terms (D6): jw_invoices.payment_terms_days (0..365)
--    + due_date, from the customer's Payment Days — like the SO invoice.
--    Existing JW invoices keep NULL (no terms were stated on them).
--
-- Backfill: every existing row gets its copy from the CURRENT customer master
-- (the best record there is — nothing was saved at the time) and
-- client_copy_at = now(). Only NEW columns are written, never an existing
-- value (invoices.client_name_text / client_gst_text are only filled where
-- NULL), so no before-copy table is needed: rollback = drop the columns.
--
-- TEST (uitsrhyulidubnddzcex) read-only 2026-09-30: invoices 0, jw_invoices 0,
-- jw_return_challans 0, customer_dispatches 3 rows; clients 195, State Code
-- and GSTIN blank on all → the 3 dispatches get name only, place_of_supply NULL.
-- PROD must be checked on its own — the NOTICE at the end reports the counts.
--
-- Additive + idempotent. Apply to BOTH the test and the production database.
-- ROLLBACK:
--   ALTER TABLE public.invoices DROP COLUMN client_address_line1, DROP COLUMN client_city,
--     DROP COLUMN client_state, DROP COLUMN client_state_code, DROP COLUMN client_pincode,
--     DROP COLUMN place_of_supply, DROP COLUMN client_copy_at;
--   ALTER TABLE public.jw_invoices DROP COLUMN client_name_text, DROP COLUMN client_gst_text,
--     DROP COLUMN client_address_line1, DROP COLUMN client_city, DROP COLUMN client_state,
--     DROP COLUMN client_state_code, DROP COLUMN client_pincode, DROP COLUMN place_of_supply,
--     DROP COLUMN client_copy_at, DROP COLUMN payment_terms_days, DROP COLUMN due_date;
--   ALTER TABLE public.jw_return_challans DROP COLUMN client_name_text, DROP COLUMN client_gst_text,
--     DROP COLUMN client_address_line1, DROP COLUMN client_city, DROP COLUMN client_state,
--     DROP COLUMN client_state_code, DROP COLUMN client_pincode, DROP COLUMN place_of_supply,
--     DROP COLUMN client_copy_at;
--   ALTER TABLE public.customer_dispatches DROP COLUMN client_gst_text,
--     DROP COLUMN client_address_line1, DROP COLUMN client_city, DROP COLUMN client_state,
--     DROP COLUMN client_state_code, DROP COLUMN client_pincode, DROP COLUMN place_of_supply,
--     DROP COLUMN client_copy_at;
-- ============================================================

-- ── invoices ────────────────────────────────────────────────────────────────
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS client_address_line1 text;
--> statement-breakpoint
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS client_city text;
--> statement-breakpoint
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS client_state text;
--> statement-breakpoint
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS client_state_code char(2);
--> statement-breakpoint
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS client_pincode text;
--> statement-breakpoint
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS place_of_supply char(2);
--> statement-breakpoint
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS client_copy_at timestamptz;
--> statement-breakpoint

-- ── jw_invoices ─────────────────────────────────────────────────────────────
ALTER TABLE public.jw_invoices ADD COLUMN IF NOT EXISTS client_name_text text;
--> statement-breakpoint
ALTER TABLE public.jw_invoices ADD COLUMN IF NOT EXISTS client_gst_text text;
--> statement-breakpoint
ALTER TABLE public.jw_invoices ADD COLUMN IF NOT EXISTS client_address_line1 text;
--> statement-breakpoint
ALTER TABLE public.jw_invoices ADD COLUMN IF NOT EXISTS client_city text;
--> statement-breakpoint
ALTER TABLE public.jw_invoices ADD COLUMN IF NOT EXISTS client_state text;
--> statement-breakpoint
ALTER TABLE public.jw_invoices ADD COLUMN IF NOT EXISTS client_state_code char(2);
--> statement-breakpoint
ALTER TABLE public.jw_invoices ADD COLUMN IF NOT EXISTS client_pincode text;
--> statement-breakpoint
ALTER TABLE public.jw_invoices ADD COLUMN IF NOT EXISTS place_of_supply char(2);
--> statement-breakpoint
ALTER TABLE public.jw_invoices ADD COLUMN IF NOT EXISTS client_copy_at timestamptz;
--> statement-breakpoint
ALTER TABLE public.jw_invoices ADD COLUMN IF NOT EXISTS payment_terms_days integer;
--> statement-breakpoint
ALTER TABLE public.jw_invoices ADD COLUMN IF NOT EXISTS due_date date;
--> statement-breakpoint

-- ── jw_return_challans ──────────────────────────────────────────────────────
ALTER TABLE public.jw_return_challans ADD COLUMN IF NOT EXISTS client_name_text text;
--> statement-breakpoint
ALTER TABLE public.jw_return_challans ADD COLUMN IF NOT EXISTS client_gst_text text;
--> statement-breakpoint
ALTER TABLE public.jw_return_challans ADD COLUMN IF NOT EXISTS client_address_line1 text;
--> statement-breakpoint
ALTER TABLE public.jw_return_challans ADD COLUMN IF NOT EXISTS client_city text;
--> statement-breakpoint
ALTER TABLE public.jw_return_challans ADD COLUMN IF NOT EXISTS client_state text;
--> statement-breakpoint
ALTER TABLE public.jw_return_challans ADD COLUMN IF NOT EXISTS client_state_code char(2);
--> statement-breakpoint
ALTER TABLE public.jw_return_challans ADD COLUMN IF NOT EXISTS client_pincode text;
--> statement-breakpoint
ALTER TABLE public.jw_return_challans ADD COLUMN IF NOT EXISTS place_of_supply char(2);
--> statement-breakpoint
ALTER TABLE public.jw_return_challans ADD COLUMN IF NOT EXISTS client_copy_at timestamptz;
--> statement-breakpoint

-- ── customer_dispatches ─────────────────────────────────────────────────────
ALTER TABLE public.customer_dispatches ADD COLUMN IF NOT EXISTS client_gst_text text;
--> statement-breakpoint
ALTER TABLE public.customer_dispatches ADD COLUMN IF NOT EXISTS client_address_line1 text;
--> statement-breakpoint
ALTER TABLE public.customer_dispatches ADD COLUMN IF NOT EXISTS client_city text;
--> statement-breakpoint
ALTER TABLE public.customer_dispatches ADD COLUMN IF NOT EXISTS client_state text;
--> statement-breakpoint
ALTER TABLE public.customer_dispatches ADD COLUMN IF NOT EXISTS client_state_code char(2);
--> statement-breakpoint
ALTER TABLE public.customer_dispatches ADD COLUMN IF NOT EXISTS client_pincode text;
--> statement-breakpoint
ALTER TABLE public.customer_dispatches ADD COLUMN IF NOT EXISTS place_of_supply char(2);
--> statement-breakpoint
ALTER TABLE public.customer_dispatches ADD COLUMN IF NOT EXISTS client_copy_at timestamptz;
--> statement-breakpoint

-- ── Comments ────────────────────────────────────────────────────────────────
COMMENT ON COLUMN public.invoices.place_of_supply IS 'Place of Supply (0186, plan D2): GST State Code billed to — customer State Code, else GSTIN prefix, Overseas 96. NULL = unknown (warn mode).';
--> statement-breakpoint
COMMENT ON COLUMN public.invoices.client_copy_at IS 'Legal copy (0186, plan D7): when the client_* copy was taken. NULL = no copy — print falls back to the live customer.';
--> statement-breakpoint
COMMENT ON COLUMN public.jw_invoices.place_of_supply IS 'Place of Supply (0186, plan D2): GST State Code billed to. NULL = unknown (warn mode).';
--> statement-breakpoint
COMMENT ON COLUMN public.jw_invoices.client_copy_at IS 'Legal copy (0186, plan D7): when the client_* copy was taken. NULL = no copy.';
--> statement-breakpoint
COMMENT ON COLUMN public.jw_invoices.payment_terms_days IS 'Payment Terms (days) (0186, plan D6): from the customer''s Payment Days. NULL on JW invoices raised before 0186.';
--> statement-breakpoint
COMMENT ON COLUMN public.jw_invoices.due_date IS 'Due Date (0186, plan D6): invoice_date + payment_terms_days.';
--> statement-breakpoint
COMMENT ON COLUMN public.jw_return_challans.client_copy_at IS 'Legal copy (0186, plan D7): when the client_* copy was taken. NULL = no copy.';
--> statement-breakpoint
COMMENT ON COLUMN public.customer_dispatches.client_copy_at IS 'Legal copy (0186, plan D7): when the client_* copy was taken (name copy = customer_text). NULL = no copy.';
--> statement-breakpoint

-- ── CHECKs (NOT VALID, validated when clean — new columns, so always clean) ─
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jw_invoices_payment_terms_days_range') THEN
    ALTER TABLE public.jw_invoices ADD CONSTRAINT jw_invoices_payment_terms_days_range CHECK (payment_terms_days IS NULL OR payment_terms_days BETWEEN 0 AND 365) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jw_invoices_payment_terms_days_range' AND NOT convalidated) THEN
    IF EXISTS (SELECT 1 FROM public.jw_invoices WHERE NOT (payment_terms_days IS NULL OR payment_terms_days BETWEEN 0 AND 365)) THEN
      RAISE NOTICE '0186: jw_invoices_payment_terms_days_range left NOT VALID — existing rows break it';
    ELSE
      ALTER TABLE public.jw_invoices VALIDATE CONSTRAINT jw_invoices_payment_terms_days_range;
    END IF;
  END IF;
END $$;
--> statement-breakpoint

-- ── Backfill: copy from the CURRENT customer master ─────────────────────────
-- Place of Supply, same rule as placeOfSupplyFor() in packages/shared
-- lib/place-of-supply.ts: Overseas → 96; the State Code; else the GSTIN's
-- first two digits when they are a GST State Code; else NULL.
UPDATE public.invoices t
SET client_name_text     = COALESCE(t.client_name_text, c.name),
    client_code_text     = COALESCE(t.client_code_text, c.code),
    client_gst_text      = COALESCE(NULLIF(btrim(t.client_gst_text), ''), NULLIF(btrim(c.gst_number), '')),
    client_address_line1 = c.address_line1,
    client_city          = c.city,
    client_state         = c.state,
    client_state_code    = c.state_code,
    client_pincode       = c.pincode,
    place_of_supply      = CASE
      WHEN c.gst_category = 'overseas' THEN '96'
      WHEN c.state_code IS NOT NULL THEN c.state_code
      WHEN left(btrim(COALESCE(NULLIF(btrim(t.client_gst_text), ''), c.gst_number, '')), 2) IN ('01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','26','27','29','30','31','32','33','34','35','36','37','38','96','97')
        THEN left(btrim(COALESCE(NULLIF(btrim(t.client_gst_text), ''), c.gst_number, '')), 2)
      ELSE NULL END,
    client_copy_at       = now()
FROM public.clients c
WHERE c.id = t.client_id AND t.client_copy_at IS NULL;
--> statement-breakpoint
-- An invoice with no customer link keeps the name / GSTIN it already has; its
-- copy is complete as it stands.
UPDATE public.invoices SET client_copy_at = now() WHERE client_copy_at IS NULL AND client_id IS NULL;
--> statement-breakpoint

UPDATE public.jw_invoices t
SET client_name_text     = c.name,
    client_gst_text      = NULLIF(btrim(c.gst_number), ''),
    client_address_line1 = c.address_line1,
    client_city          = c.city,
    client_state         = c.state,
    client_state_code    = c.state_code,
    client_pincode       = c.pincode,
    place_of_supply      = CASE
      WHEN c.gst_category = 'overseas' THEN '96'
      WHEN c.state_code IS NOT NULL THEN c.state_code
      WHEN left(btrim(COALESCE(c.gst_number, '')), 2) IN ('01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','26','27','29','30','31','32','33','34','35','36','37','38','96','97')
        THEN left(btrim(c.gst_number), 2)
      ELSE NULL END,
    client_copy_at       = now()
FROM public.job_work_orders j
CROSS JOIN public.clients c
WHERE j.id = t.job_work_order_id
  AND c.id = COALESCE(t.client_id, j.client_id)
  AND t.client_copy_at IS NULL;
--> statement-breakpoint

UPDATE public.jw_return_challans t
SET client_name_text     = c.name,
    client_gst_text      = NULLIF(btrim(c.gst_number), ''),
    client_address_line1 = c.address_line1,
    client_city          = c.city,
    client_state         = c.state,
    client_state_code    = c.state_code,
    client_pincode       = c.pincode,
    place_of_supply      = CASE
      WHEN c.gst_category = 'overseas' THEN '96'
      WHEN c.state_code IS NOT NULL THEN c.state_code
      WHEN left(btrim(COALESCE(c.gst_number, '')), 2) IN ('01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','26','27','29','30','31','32','33','34','35','36','37','38','96','97')
        THEN left(btrim(c.gst_number), 2)
      ELSE NULL END,
    client_copy_at       = now()
FROM public.job_work_orders j
CROSS JOIN public.clients c
WHERE j.id = t.job_work_order_id
  AND c.id = COALESCE(t.client_id, j.client_id)
  AND t.client_copy_at IS NULL;
--> statement-breakpoint

UPDATE public.customer_dispatches t
SET customer_text        = COALESCE(NULLIF(btrim(t.customer_text), ''), c.name),
    client_gst_text      = NULLIF(btrim(c.gst_number), ''),
    client_address_line1 = c.address_line1,
    client_city          = c.city,
    client_state         = c.state,
    client_state_code    = c.state_code,
    client_pincode       = c.pincode,
    place_of_supply      = CASE
      WHEN c.gst_category = 'overseas' THEN '96'
      WHEN c.state_code IS NOT NULL THEN c.state_code
      WHEN left(btrim(COALESCE(c.gst_number, '')), 2) IN ('01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','26','27','29','30','31','32','33','34','35','36','37','38','96','97')
        THEN left(btrim(c.gst_number), 2)
      ELSE NULL END,
    client_copy_at       = now()
FROM public.sales_orders s
CROSS JOIN public.clients c
WHERE s.id = t.sales_order_id
  AND c.id = s.client_id
  AND t.client_copy_at IS NULL;
--> statement-breakpoint

-- Report what the backfill did (rows left without a copy had no customer link).
DO $$
DECLARE
  inv_n integer; inv_left integer; inv_pos integer;
  jwi_n integer; jwi_left integer;
  jwr_n integer; jwr_left integer;
  dsp_n integer; dsp_left integer;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE client_copy_at IS NULL), count(*) FILTER (WHERE place_of_supply IS NULL)
    INTO inv_n, inv_left, inv_pos FROM public.invoices WHERE deleted_at IS NULL;
  SELECT count(*), count(*) FILTER (WHERE client_copy_at IS NULL) INTO jwi_n, jwi_left FROM public.jw_invoices WHERE deleted_at IS NULL;
  SELECT count(*), count(*) FILTER (WHERE client_copy_at IS NULL) INTO jwr_n, jwr_left FROM public.jw_return_challans WHERE deleted_at IS NULL;
  SELECT count(*), count(*) FILTER (WHERE client_copy_at IS NULL) INTO dsp_n, dsp_left FROM public.customer_dispatches WHERE deleted_at IS NULL;
  RAISE NOTICE '0186: invoices % (no copy %, Place of Supply unknown %); jw_invoices % (no copy %); jw_return_challans % (no copy %); customer_dispatches % (no copy %)',
    inv_n, inv_left, inv_pos, jwi_n, jwi_left, jwr_n, jwr_left, dsp_n, dsp_left;
END $$;
