-- ADR-290 — a Drawing Rev added straight in the Drawing Register
-- (POST /item-revisions) records source_type 'register'. The two CHECKs from
-- 0232 gain that one value; nothing else changes. Additive: every existing row
-- already satisfies the wider check.
--
-- ROLLBACK (only while no row has source_type = 'register'):
--   re-create both checks with the 0232 list.

ALTER TABLE public.item_revisions DROP CONSTRAINT IF EXISTS item_revisions_source_type_check;
--> statement-breakpoint
ALTER TABLE public.item_revisions ADD CONSTRAINT item_revisions_source_type_check
  CHECK (source_type IN ('so_line', 'jw_line', 'route_card', 'bom_line', 'ml_bom_line', 'legacy', 'register'));
--> statement-breakpoint
ALTER TABLE public.item_revision_drawings DROP CONSTRAINT IF EXISTS item_revision_drawings_source_type_check;
--> statement-breakpoint
ALTER TABLE public.item_revision_drawings ADD CONSTRAINT item_revision_drawings_source_type_check
  CHECK (source_type IS NULL OR source_type IN ('so_line', 'jw_line', 'route_card', 'bom_line', 'ml_bom_line', 'legacy', 'register'));
