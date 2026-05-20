-- ============================================================
-- 0023_phase8_cost_centers
-- CC-1 (Phase A item 4 of LEGACY_AUDIT.md build plan — Cost
-- Center Master). Mirrors legacy renderCostCenters L17165.
--
-- 6 business fields:
--   code         text, NOT NULL — unique per company (legacy
--                stores codes like CC-001).
--   name         text, NOT NULL — display name.
--   department   text, nullable — Production / QC /
--                Maintenance / Store / Admin / Design /
--                Purchase / Sales / Other (free-text in
--                legacy; we leave as text rather than enum
--                so future departments don't need migrations).
--   type         text, nullable — Manufacturing / Overhead /
--                Service (free-text for the same reason).
--   description  text, nullable.
--   is_active    boolean NOT NULL DEFAULT true.
--
-- Plus the standard audit + RLS columns. `sales_orders.cost_center`
-- (text snapshot, schema.ts L912) already references the code —
-- a future migration can promote it to FK; this slice ships the
-- master only.
--
-- Idempotent — safe to re-run via _apply_0023.
-- ============================================================

CREATE TABLE IF NOT EXISTS "cost_centers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "code" text NOT NULL,
  "name" text NOT NULL,
  "department" text,
  "type" text,
  "description" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "cost_centers_company_code_uniq"
  ON "cost_centers" ("company_id", "code")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "cost_centers_company_active_idx"
  ON "cost_centers" ("company_id", "is_active")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "cost_centers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "cost_centers_company_read" ON "cost_centers"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "cost_centers_manager_write" ON "cost_centers"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
