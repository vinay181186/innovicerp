-- ============================================================
-- 0182_dc_vendor_code_and_po_tax_type.sql  (fix wave 1, area C — A32 + S1)
--
-- A32 — the OSP DC screen wrote the PO NUMBER into
--   delivery_challans.vendor_code_text (web: `po.vendorCodeText ?? po.code`),
--   the PO renumber routine kept rewriting it, and the OSP receipt copied it
--   into the auto-GRN's goods_receipt_notes.vendor_code_text. The code is
--   fixed (the column now holds the vendor's code); this puts the vendor's
--   code back on the old rows:
--     a row is corrected ONLY when its vendor_code_text equals a PO number
--     (its own po_code_text, or any PO code of the same company) AND the row
--     has a linked vendor — the new value is that vendor's master code.
--     Rows without a vendor link are left as they are.
--
-- S1 — purchase_orders.tax_type was free text; TEST holds 'cgst_sgst' (4 rows)
--   while the code writes 'sgst_cgst'. Spellings of the two known values are
--   normalised, then the same CHECK invoices / jw_invoices carry (0171 / 0148)
--   is added NOT VALID and validated only when no other value remains.
--
-- Every changed value is copied first into public._fix0182_backup
-- (table, row id, column, old value) — one row per (table, id, column), so a
-- re-run neither duplicates the copy nor overwrites the first old value.
-- Idempotent: every UPDATE matches only rows still holding a wrong value.
-- Apply to BOTH the test and the production database.
-- ROLLBACK:
--   ALTER TABLE public.purchase_orders DROP CONSTRAINT purchase_orders_tax_type_check;
--   UPDATE <tbl> SET <col> = b.old_value FROM public._fix0182_backup b
--     WHERE b.tbl = '<tbl>' AND b.col = '<col>' AND <tbl>.id = b.row_id;
--   DROP TABLE public._fix0182_backup;
-- ============================================================

CREATE TABLE IF NOT EXISTS public._fix0182_backup (
  tbl text NOT NULL,
  row_id uuid NOT NULL,
  col text NOT NULL,
  old_value text,
  fixed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tbl, row_id, col)
);
--> statement-breakpoint
-- RLS on, no policies: PostgREST (anon / authenticated) cannot read or write it.
ALTER TABLE public._fix0182_backup ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
COMMENT ON TABLE public._fix0182_backup IS
  'Before-copy of the values migration 0182 corrected (DC / GRN vendor code held a PO number; PO tax_type spelling). Safe to drop once checked.';
--> statement-breakpoint

-- ── A32: delivery_challans.vendor_code_text ─────────────────────────────────
INSERT INTO public._fix0182_backup (tbl, row_id, col, old_value)
SELECT 'delivery_challans', d.id, 'vendor_code_text', d.vendor_code_text
FROM public.delivery_challans d
JOIN public.vendors v ON v.id = d.vendor_id
WHERE d.vendor_code_text IS DISTINCT FROM v.code
  AND (
    d.vendor_code_text = d.po_code_text
    OR EXISTS (
      SELECT 1 FROM public.purchase_orders p
      WHERE p.company_id = d.company_id AND p.code = d.vendor_code_text
    )
  )
ON CONFLICT (tbl, row_id, col) DO NOTHING;
--> statement-breakpoint
UPDATE public.delivery_challans d
SET vendor_code_text = v.code
FROM public.vendors v
WHERE v.id = d.vendor_id
  AND d.vendor_code_text IS DISTINCT FROM v.code
  AND (
    d.vendor_code_text = d.po_code_text
    OR EXISTS (
      SELECT 1 FROM public.purchase_orders p
      WHERE p.company_id = d.company_id AND p.code = d.vendor_code_text
    )
  );
--> statement-breakpoint

-- ── A32: goods_receipt_notes.vendor_code_text (the OSP-receipt copy) ────────
INSERT INTO public._fix0182_backup (tbl, row_id, col, old_value)
SELECT 'goods_receipt_notes', g.id, 'vendor_code_text', g.vendor_code_text
FROM public.goods_receipt_notes g
JOIN public.vendors v ON v.id = g.vendor_id
WHERE g.vendor_code_text IS DISTINCT FROM v.code
  AND (
    g.vendor_code_text = g.po_code_text
    OR EXISTS (
      SELECT 1 FROM public.purchase_orders p
      WHERE p.company_id = g.company_id AND p.code = g.vendor_code_text
    )
  )
ON CONFLICT (tbl, row_id, col) DO NOTHING;
--> statement-breakpoint
UPDATE public.goods_receipt_notes g
SET vendor_code_text = v.code
FROM public.vendors v
WHERE v.id = g.vendor_id
  AND g.vendor_code_text IS DISTINCT FROM v.code
  AND (
    g.vendor_code_text = g.po_code_text
    OR EXISTS (
      SELECT 1 FROM public.purchase_orders p
      WHERE p.company_id = g.company_id AND p.code = g.vendor_code_text
    )
  );
--> statement-breakpoint

-- ── S1: purchase_orders.tax_type → 'sgst_cgst' | 'igst' | NULL ─────────────
INSERT INTO public._fix0182_backup (tbl, row_id, col, old_value)
SELECT 'purchase_orders', p.id, 'tax_type', p.tax_type
FROM public.purchase_orders p
WHERE p.tax_type IS NOT NULL
  AND p.tax_type NOT IN ('sgst_cgst', 'igst')
  AND (
    lower(btrim(p.tax_type)) IN ('cgst_sgst', 'sgst_cgst', 'sgst+cgst', 'cgst+sgst', 'igst', '')
  )
ON CONFLICT (tbl, row_id, col) DO NOTHING;
--> statement-breakpoint
UPDATE public.purchase_orders
SET tax_type = CASE
    WHEN lower(btrim(tax_type)) IN ('cgst_sgst', 'sgst_cgst', 'sgst+cgst', 'cgst+sgst') THEN 'sgst_cgst'
    WHEN lower(btrim(tax_type)) = 'igst' THEN 'igst'
    ELSE NULL
  END
WHERE tax_type IS NOT NULL
  AND tax_type NOT IN ('sgst_cgst', 'igst')
  AND lower(btrim(tax_type)) IN ('cgst_sgst', 'sgst_cgst', 'sgst+cgst', 'cgst+sgst', 'igst', '');
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.purchase_orders'::regclass
      AND conname = 'purchase_orders_tax_type_check'
  ) THEN
    ALTER TABLE public.purchase_orders
      ADD CONSTRAINT purchase_orders_tax_type_check
      CHECK (tax_type IS NULL OR tax_type IN ('sgst_cgst', 'igst')) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.purchase_orders
    WHERE tax_type IS NOT NULL AND tax_type NOT IN ('sgst_cgst', 'igst')
  ) THEN
    RAISE NOTICE '0182: purchase_orders_tax_type_check left NOT VALID — unknown tax_type values remain (new writes are still checked).';
  ELSE
    ALTER TABLE public.purchase_orders VALIDATE CONSTRAINT purchase_orders_tax_type_check;
  END IF;
END $$;
