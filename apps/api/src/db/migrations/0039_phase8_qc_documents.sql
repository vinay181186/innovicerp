-- ============================================================
-- 0039_phase8_qc_documents
-- QC Documents — file repository (MIR / MCR / inspection / TPI reports etc.)
-- per JC / SO. Mirrors legacy renderQCDocuments HTML L23039 + fileRegistry.
-- Stands up the app's first file-Storage capability:
--   1) a private Supabase Storage bucket `qc-docs`,
--   2) storage.objects RLS for authenticated users on that bucket,
--   3) the qc_documents metadata table (registers each uploaded object).
-- Client uploads to Storage directly; the metadata row is registered via the
-- API. See docs/PARITY/qc-documents.md. Idempotent.
-- ============================================================

-- 1) Storage bucket (private; access via signed URLs).
INSERT INTO storage.buckets (id, name, public)
VALUES ('qc-docs', 'qc-docs', false)
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint

-- 2) storage.objects policies for the qc-docs bucket (authenticated).
DO $$ BEGIN
  CREATE POLICY "qc_docs_authenticated_read" ON storage.objects
    FOR SELECT TO authenticated USING (bucket_id = 'qc-docs');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "qc_docs_authenticated_insert" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (bucket_id = 'qc-docs');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "qc_docs_authenticated_delete" ON storage.objects
    FOR DELETE TO authenticated USING (bucket_id = 'qc-docs');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- 3) qc_documents metadata table.
CREATE TABLE IF NOT EXISTS "qc_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "job_card_id" uuid REFERENCES "job_cards"("id") ON DELETE SET NULL,
  "jc_code_text" text,
  "sales_order_id" uuid REFERENCES "sales_orders"("id") ON DELETE SET NULL,
  "so_code_text" text,
  "category" text NOT NULL DEFAULT 'qc-docs',   -- qc-docs|drawing|inspection|tpi|incoming-qc|po-docs|design|dispatch|other
  "doc_type" text NOT NULL,                       -- MIR | MCR | Inspection Report | ...
  "file_name" text NOT NULL,
  "storage_path" text NOT NULL,                   -- path within the qc-docs bucket
  "uploaded_by_text" text,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "qc_documents_company_jc_idx"
  ON "qc_documents" ("company_id", "job_card_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qc_documents_company_cat_idx"
  ON "qc_documents" ("company_id", "category") WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "qc_documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "qc_documents_company_read" ON "qc_documents"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "qc_documents_qc_write" ON "qc_documents"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager', 'qc') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager', 'qc') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
