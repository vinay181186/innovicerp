-- Reference-linkage FKs + one-of CHECK backstops (ADR-080).
-- Additive & non-destructive. Pre-verified on prod: 0 rows violate any CHECK;
-- backfill covers 32 POs and 21 GRNs (2 GRNs have an orphan dc_no text -> stay null).

-- 1) PR -> PO forward FK (was only reverse purchase_requests.po_id + free text).
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS pr_id uuid REFERENCES public.purchase_requests(id) ON DELETE SET NULL;
--> statement-breakpoint
UPDATE public.purchase_orders po
  SET pr_id = pr.id
  FROM public.purchase_requests pr
  WHERE pr.po_id = po.id AND pr.deleted_at IS NULL AND po.pr_id IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS purchase_orders_company_pr_idx
  ON public.purchase_orders (company_id, pr_id) WHERE deleted_at IS NULL;
--> statement-breakpoint

-- 2) GRN -> DC forward FK for OSP-return GRNs (was only dc_no text, unnavigable).
ALTER TABLE public.goods_receipt_notes
  ADD COLUMN IF NOT EXISTS delivery_challan_id uuid REFERENCES public.delivery_challans(id) ON DELETE SET NULL;
--> statement-breakpoint
UPDATE public.goods_receipt_notes g
  SET delivery_challan_id = d.id
  FROM public.delivery_challans d
  WHERE d.code = g.dc_no AND d.company_id = g.company_id AND d.deleted_at IS NULL
    AND g.delivery_challan_id IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS goods_receipt_notes_company_dc_idx
  ON public.goods_receipt_notes (company_id, delivery_challan_id) WHERE deleted_at IS NULL;
--> statement-breakpoint

-- 3) One-of (id OR text) CHECK backstops where the Zod refine already enforces it,
--    so a code-path that forgets the pair can't persist a reference-less row.
--    (GRN header vendor intentionally excluded — creating vendor-less GRNs is
--    still allowed until the create-path requires a vendor; separate change.)
ALTER TABLE public.purchase_orders
  ADD CONSTRAINT purchase_orders_vendor_one_of
  CHECK (num_nonnulls(vendor_id, vendor_code_text) >= 1);
--> statement-breakpoint
ALTER TABLE public.purchase_order_lines
  ADD CONSTRAINT purchase_order_lines_item_one_of
  CHECK (num_nonnulls(item_id, item_code_text) >= 1);
--> statement-breakpoint
ALTER TABLE public.goods_receipt_note_lines
  ADD CONSTRAINT goods_receipt_note_lines_item_one_of
  CHECK (num_nonnulls(item_id, item_code_text) >= 1);
