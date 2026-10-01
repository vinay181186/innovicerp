-- ============================================================
-- 0189_user_table_prefs
-- Per-user table preferences (ADR-199, table standard phase 2).
--   1. user_ui_settings — one row per user per setting key. First key:
--      'table_density' = comfortable | compact, applied to EVERY table.
--   2. user_table_columns — one row per user per table per column:
--      position (left-to-right), pinned, hidden. A column is never both
--      pinned and hidden. "Reset to default" soft-deletes the user's rows.
-- Both tables are private to the user: RLS lets a user read and write only
-- their own rows inside their own company (no manager override — these are
-- personal screen preferences, not records).
-- The API connects as postgres (RLS not enforced at runtime); the service
-- filters company_id AND user_id on every query.
-- Additive and idempotent — new tables only, no data change.
-- Apply: DB_TARGET=TEST|PROD … tsx src/db/apply-sql.ts (see apply-sql.ts header).
-- ============================================================

CREATE TABLE IF NOT EXISTS "user_ui_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "setting_key" text NOT NULL,
  "setting_value" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,
  "deleted_by" uuid REFERENCES "users"("id"),
  CONSTRAINT "user_ui_settings_setting_key_format" CHECK ("setting_key" ~ '^[a-z_]{1,64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_ui_settings_company_user_key_uq"
  ON "user_ui_settings" ("company_id", "user_id", "setting_key") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER user_ui_settings_set_updated_at
  BEFORE UPDATE ON public.user_ui_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
ALTER TABLE "user_ui_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "user_ui_settings_self_read" ON "user_ui_settings"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id() AND user_id = current_user_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "user_ui_settings_self_write" ON "user_ui_settings"
    FOR ALL TO authenticated
    USING (company_id = current_company_id() AND user_id = current_user_id())
    WITH CHECK (company_id = current_company_id() AND user_id = current_user_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_table_columns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "table_key" text NOT NULL,
  "column_key" text NOT NULL,
  "position" integer NOT NULL,
  "pinned" boolean NOT NULL DEFAULT false,
  "hidden" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,
  "deleted_by" uuid REFERENCES "users"("id"),
  CONSTRAINT "user_table_columns_table_key_format" CHECK ("table_key" ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  CONSTRAINT "user_table_columns_column_key_format" CHECK ("column_key" ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'),
  CONSTRAINT "user_table_columns_position_range" CHECK ("position" BETWEEN 0 AND 200),
  CONSTRAINT "user_table_columns_not_pinned_and_hidden" CHECK (NOT ("pinned" AND "hidden"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_table_columns_company_user_table_column_uq"
  ON "user_table_columns" ("company_id", "user_id", "table_key", "column_key") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_table_columns_user_table_idx"
  ON "user_table_columns" ("user_id", "table_key") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER user_table_columns_set_updated_at
  BEFORE UPDATE ON public.user_table_columns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
ALTER TABLE "user_table_columns" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "user_table_columns_self_read" ON "user_table_columns"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id() AND user_id = current_user_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "user_table_columns_self_write" ON "user_table_columns"
    FOR ALL TO authenticated
    USING (company_id = current_company_id() AND user_id = current_user_id())
    WITH CHECK (company_id = current_company_id() AND user_id = current_user_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------
-- DOWN (rollback reference only — NOT run by apply-sql; copy by hand).
-- Destroys every saved density + column layout.
--
-- DROP POLICY IF EXISTS "user_table_columns_self_write" ON "user_table_columns";
-- DROP POLICY IF EXISTS "user_table_columns_self_read" ON "user_table_columns";
-- DROP TABLE IF EXISTS "user_table_columns";
-- DROP POLICY IF EXISTS "user_ui_settings_self_write" ON "user_ui_settings";
-- DROP POLICY IF EXISTS "user_ui_settings_self_read" ON "user_ui_settings";
-- DROP TABLE IF EXISTS "user_ui_settings";
-- ------------------------------------------------------------
