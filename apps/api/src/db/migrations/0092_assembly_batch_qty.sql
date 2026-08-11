-- ============================================================
-- 0092_assembly_batch_qty
-- Batch assemble: one assembly_units record can now represent QTY units built
-- in a single action (sharing one auto-generated serial), instead of forcing
-- one row per unit. The user asked to build e.g. 5 units in one click.
--
-- Every readiness rollup was switched from COUNT(rows) to SUM(qty)
-- (assembly/service.ts + the list aggregate), so existing rows must read as
-- qty = 1 — the column DEFAULT backfills them, no data migration needed.
--   • qty NOT NULL DEFAULT 1  — legacy / pre-batch rows are one unit each.
--   • CHECK qty > 0           — mirrors assembly_units_unit_no_positive.
--
-- The stock cascade multiplies each BOM line's qtyPerSet by this qty, so a
-- batch of 5 debits 5 sets of components (ADR-115). Idempotent; applied via
-- src/db/apply-sql.ts.
-- ============================================================

ALTER TABLE "assembly_units" ADD COLUMN IF NOT EXISTS "qty" integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assembly_units_qty_positive'
  ) THEN
    ALTER TABLE "assembly_units"
      ADD CONSTRAINT "assembly_units_qty_positive" CHECK ("qty" > 0);
  END IF;
END $$;
