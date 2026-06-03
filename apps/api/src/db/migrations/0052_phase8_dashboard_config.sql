-- ============================================================
-- 0052_phase8_dashboard_config
-- Dashboard (home) module (ADR-044). Per-user home layout preference.
-- Mirror of legacy db.dashboardConfig = [{userId, widgets:[], quickLinks:[]}].
--   widgets / quick_links are ordered lists of UI keys (layout preference),
--   stored as jsonb — NOT the entity-blob anti-pattern (these are not records).
--   null = show all (defaults). One row per user.
-- Additive — new table only.
-- ============================================================

CREATE TABLE IF NOT EXISTS "dashboard_config" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "widgets" jsonb,
  "quick_links" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dashboard_config_company_user_uq"
  ON "dashboard_config" ("company_id", "user_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "dashboard_config" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "dashboard_config_company_read" ON "dashboard_config"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "dashboard_config_self_or_manager_write" ON "dashboard_config"
    FOR ALL TO authenticated
    USING (company_id = current_company_id() AND (user_id = current_user_id() OR current_user_role() IN ('admin','manager')))
    WITH CHECK (company_id = current_company_id() AND (user_id = current_user_id() OR current_user_role() IN ('admin','manager')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
