-- ============================================================
-- 0055_so_documents_file_registry
-- SO Documents module (ADR-047). Unified general-purpose file metadata
-- registry. Legacy kept ONE db.fileRegistry aggregating every uploaded file
-- system-wide; renderSODocs reads it keyed by soNo + soLineNo. Our files are
-- stored per-module, so this is the canonical registry going forward — the SO
-- Documents screen is its first producer/consumer. Files live in the `qc-docs`
-- Storage bucket; this table holds the metadata. QC docs keep qc_documents and
-- are surfaced read-only on SO Documents via UNION (not duplicated here).
-- Additive — new table only.
-- ============================================================

CREATE TABLE IF NOT EXISTS "file_registry" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "sales_order_id" uuid REFERENCES "sales_orders"("id") ON DELETE SET NULL,
  "so_code_text" text,
  "so_line_id" uuid REFERENCES "sales_order_lines"("id") ON DELETE SET NULL,
  "so_line_no" integer,
  "job_card_id" uuid REFERENCES "job_cards"("id") ON DELETE SET NULL,
  "jc_code_text" text,
  "category" text NOT NULL DEFAULT 'other',
  "doc_type" text,
  "file_name" text NOT NULL,
  "storage_path" text NOT NULL,
  "file_size" integer,
  "file_type" text,
  "status" text NOT NULL DEFAULT 'active',
  "uploaded_by_text" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_registry_company_so_idx"
  ON "file_registry" ("company_id", "sales_order_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_registry_company_status_idx"
  ON "file_registry" ("company_id", "status") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "file_registry" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "file_registry_company_read" ON "file_registry"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "file_registry_write" ON "file_registry"
    FOR ALL TO authenticated
    USING (current_user_role() <> 'viewer' AND company_id = current_company_id())
    WITH CHECK (current_user_role() <> 'viewer' AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
