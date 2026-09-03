-- ============================================================
-- 0105_material_grade_size_masters
--
-- Two new masters behind ONE menu entry ("Raw Material Master", Production →
-- Master, tabs Grade | Size):
--
--   material_grades  — EN24, EN8, SS304 …
--   material_sizes   — 'Ø30 × 1000', '50 × 6 FLAT' … ONE free box, by decision
--
-- The two are INDEPENDENT: a size is not scoped to a grade, so picking EN24
-- does not narrow the size list. Both are ordinary company-scoped masters,
-- shaped exactly like machines / operators — auto code series (GRD-### and
-- SZ-####), soft delete, Active flag, audit columns, RLS.
--
-- Item Master's existing free-text `material` column is deliberately NOT
-- touched and NOT migrated into these tables.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS "material_grades" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  -- Auto GRD-### in the company series; a caller may pass its own.
  "code" text NOT NULL,
  -- The grade as written on the shop floor.
  "name" text NOT NULL,
  "description" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "material_sizes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  -- Auto SZ-#### in the company series; a caller may pass its own.
  "code" text NOT NULL,
  -- The size verbatim, symbols and all.
  "name" text NOT NULL,
  "description" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz
);
--> statement-breakpoint

-- Code is unique per company among LIVE rows only, so a deleted code is not
-- re-issued by the series but also does not block a deliberate re-entry.
CREATE UNIQUE INDEX IF NOT EXISTS "material_grades_company_code_uniq"
  ON "material_grades" ("company_id", "code") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "material_sizes_company_code_uniq"
  ON "material_sizes" ("company_id", "code") WHERE "deleted_at" IS NULL;
--> statement-breakpoint

-- Name lookups drive both the master list search and the plan/JC pickers.
CREATE INDEX IF NOT EXISTS "material_grades_company_name_idx"
  ON "material_grades" ("company_id", "name") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_sizes_company_name_idx"
  ON "material_sizes" ("company_id", "name") WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "material_grades" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "material_sizes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "material_grades_company_read" ON "material_grades"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "material_grades_manager_write" ON "material_grades"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "material_sizes_company_read" ON "material_sizes"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "material_sizes_manager_write" ON "material_sizes"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
