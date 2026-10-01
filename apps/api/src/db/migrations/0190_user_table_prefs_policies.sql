-- ============================================================
-- 0190_user_table_prefs_policies
-- Code-review follow-up to 0189 (ADR-199, per-user table preferences).
--   1. Drop user_table_columns_user_table_idx — redundant: the partial unique
--      index (company_id, user_id, table_key, column_key) WHERE deleted_at IS
--      NULL already serves every lookup the API makes (it always filters
--      company_id + user_id + table_key).
--   2. Tighten the two *_self_write policies: a write must also stamp the
--      writer — updated_by = current_user_id(), and deleted_by is either empty
--      or the writer. (created_by cannot be checked on UPDATE, so it is left
--      out.) USING is unchanged.
-- Idempotent (DROP … IF EXISTS then CREATE). apply-sql runs the file in one
-- transaction, so the policies are never missing between drop and create.
-- No data change.
-- ============================================================

DROP INDEX IF EXISTS "user_table_columns_user_table_idx";
--> statement-breakpoint
DROP POLICY IF EXISTS "user_ui_settings_self_write" ON "user_ui_settings";
--> statement-breakpoint
CREATE POLICY "user_ui_settings_self_write" ON "user_ui_settings"
  FOR ALL TO authenticated
  USING (company_id = current_company_id() AND user_id = current_user_id())
  WITH CHECK (
    company_id = current_company_id()
    AND user_id = current_user_id()
    AND updated_by = current_user_id()
    AND (deleted_by IS NULL OR deleted_by = current_user_id())
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "user_table_columns_self_write" ON "user_table_columns";
--> statement-breakpoint
CREATE POLICY "user_table_columns_self_write" ON "user_table_columns"
  FOR ALL TO authenticated
  USING (company_id = current_company_id() AND user_id = current_user_id())
  WITH CHECK (
    company_id = current_company_id()
    AND user_id = current_user_id()
    AND updated_by = current_user_id()
    AND (deleted_by IS NULL OR deleted_by = current_user_id())
  );

-- ------------------------------------------------------------
-- DOWN (rollback reference only — NOT run by apply-sql; copy by hand).
--
-- CREATE INDEX IF NOT EXISTS "user_table_columns_user_table_idx"
--   ON "user_table_columns" ("user_id", "table_key") WHERE "deleted_at" IS NULL;
-- DROP POLICY IF EXISTS "user_ui_settings_self_write" ON "user_ui_settings";
-- CREATE POLICY "user_ui_settings_self_write" ON "user_ui_settings"
--   FOR ALL TO authenticated
--   USING (company_id = current_company_id() AND user_id = current_user_id())
--   WITH CHECK (company_id = current_company_id() AND user_id = current_user_id());
-- DROP POLICY IF EXISTS "user_table_columns_self_write" ON "user_table_columns";
-- CREATE POLICY "user_table_columns_self_write" ON "user_table_columns"
--   FOR ALL TO authenticated
--   USING (company_id = current_company_id() AND user_id = current_user_id())
--   WITH CHECK (company_id = current_company_id() AND user_id = current_user_id());
-- ------------------------------------------------------------
