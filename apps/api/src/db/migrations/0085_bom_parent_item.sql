-- 0085 — BOM Master gets an explicit PARENT item (the thing being assembled).
--
-- Until now a BOM was only a bag of child parts; which item those parts build
-- was implied by whatever sales-order line happened to point at the BOM. That
-- left the assembly itself unnamed, which is why an equipment SO could be
-- planned and produced but never dispatched — nothing ever identified the
-- finished parent to credit.
--
-- NULLABLE on purpose. Six BOMs already exist without a parent; a NOT NULL
-- column would refuse the ALTER, and we have no way to guess their parent
-- (no sales_order_lines row references any of them). The API requires a
-- parent on every create AND every update, so each old BOM gets one the
-- next time somebody edits it. Revisit making this NOT NULL once the
-- backfill query below returns zero.
--
--   SELECT bom_no FROM public.bom_masters
--   WHERE parent_item_id IS NULL AND deleted_at IS NULL;
--
-- Each statement stands alone (apply-sql.ts runs them individually) and is
-- re-runnable.

ALTER TABLE public.bom_masters
  ADD COLUMN IF NOT EXISTS parent_item_id uuid REFERENCES public.items (id);

-- Postgres does not auto-index foreign keys. This one is read on every BOM
-- list + detail (to join the parent's code/name) and will be read by the
-- "which BOM builds this item?" lookup.
CREATE INDEX IF NOT EXISTS bom_masters_parent_item_idx
  ON public.bom_masters (parent_item_id)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.bom_masters.parent_item_id IS
  'The assembled item this BOM builds. Exactly one per BOM. Nullable only for the six pre-0085 BOMs; the API requires it on every write.';
