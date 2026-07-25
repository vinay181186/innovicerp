-- GRN header vendor one-of CHECK backstop.
-- Completes the item deferred in 0075 (see its note #3): the GRN header was the
-- only receipt doc that could persist with NO vendor (vendor_id NULL AND
-- vendor_code_text NULL). The Zod create refine now enforces vendor-required;
-- this CHECK stops any code path that forgets the pair from persisting a
-- vendor-less GRN. Additive & non-destructive.
-- Pre-verified on prod: 0 existing rows violate, so it applies cleanly.
-- The OSP auto-GRN (insertGrnForOspReceipt) copies vendor_id / vendor_code_text
-- from the source DC header, so it satisfies the constraint.
ALTER TABLE public.goods_receipt_notes
  ADD CONSTRAINT goods_receipt_notes_vendor_one_of
  CHECK (num_nonnulls(vendor_id, vendor_code_text) >= 1);
