-- 0267 — ADR-307 follow-up: a BOM line whose part is a Party Supplied Material
-- (-RM) item is BOM Type 'party_supplied'. Lines saved before ADR-307 reached
-- PROD (17-Nov) can still read 'purchase' — BOM-0001 Rev 2 (16-Nov) has two, so
-- BOM Planning on SO-441 asked for a vendor for a part the customer sends.
-- The save path already refuses this mix (bom-master/service.ts); this moves the
-- old rows. No revision bump: the part list is unchanged, only its type.
-- Idempotent: a second run finds nothing to move.

UPDATE public.bom_master_lines bml
   SET bom_type = 'party_supplied',
       updated_at = now()
  FROM public.items i
 WHERE i.id = bml.child_item_id
   AND i.item_type = 'party_supplied_material'
   AND bml.bom_type <> 'party_supplied'
   AND bml.deleted_at IS NULL;
