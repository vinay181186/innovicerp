-- ============================================================
-- 0042_phase8_print_templates
-- Print Templates (A) — admin-customisable editable text blocks for the
-- PO / OSP DC / JW DC printed documents, plus last-5 revision history.
-- Mirror of legacy db.printTemplates + db.printTemplateRevisions
-- (renderPrintTemplates HTML L14660; infra L14439-14605).
-- A missing row ⇒ the factory default (PRINT_TEMPLATE_DEFAULTS in
-- packages/shared) is used. Writes are ADMIN-ONLY (legacy isAdmin() gate).
-- Revisions are append-only and capped at 5 per key in the service.
-- See docs/PARITY/print-templates.md. Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS "print_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "template_key" text NOT NULL,
  "content" text NOT NULL DEFAULT '',

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz
);
--> statement-breakpoint

-- One active customised row per (company, template_key); upsert target.
CREATE UNIQUE INDEX IF NOT EXISTS "print_templates_company_key_uq"
  ON "print_templates" ("company_id", "template_key") WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "print_templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "print_templates_company_read" ON "print_templates"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "print_templates_admin_write" ON "print_templates"
    FOR ALL TO authenticated
    USING (current_user_role() = 'admin' AND company_id = current_company_id())
    WITH CHECK (current_user_role() = 'admin' AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ── Revision history (append-only, last 5 per key kept by the service) ──
CREATE TABLE IF NOT EXISTS "print_template_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "template_key" text NOT NULL,
  "content" text NOT NULL,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "print_template_revisions_company_key_created_idx"
  ON "print_template_revisions" ("company_id", "template_key", "created_at");
--> statement-breakpoint

ALTER TABLE "print_template_revisions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "print_template_revisions_company_read" ON "print_template_revisions"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "print_template_revisions_admin_insert" ON "print_template_revisions"
    FOR INSERT TO authenticated
    WITH CHECK (current_user_role() = 'admin' AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
