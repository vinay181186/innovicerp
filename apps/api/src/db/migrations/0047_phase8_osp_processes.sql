-- ============================================================
-- 0047_phase8_osp_processes
-- OSP Process Configuration — list of outside-process names (Coating /
-- Painting / Heat Treatment / …) with an optional preferred vendor +
-- auto-PO flag + lead-time. Mirror of legacy db.ospProcessConfig
-- (Settings page L13231–13298 + _isOspOperation L13295).
--
-- Admin/manager writes (legacy gated on isAdmin/isManager for the
-- Settings page). The downstream "if an op name matches → auto-create
-- JW PR" wiring is a follow-up; this migration just lands storage.
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS "osp_processes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "process_name" text NOT NULL,
  "vendor_id" uuid REFERENCES "vendors"("id"),
  "auto_po" boolean NOT NULL DEFAULT false,
  "lead_days" integer NOT NULL DEFAULT 5,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz
);
--> statement-breakpoint

-- Case-insensitive uniqueness per company (legacy used lowercase compare).
CREATE UNIQUE INDEX IF NOT EXISTS "osp_processes_company_name_uq"
  ON "osp_processes" ("company_id", LOWER("process_name")) WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "osp_processes_company_idx"
  ON "osp_processes" ("company_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "osp_processes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "osp_processes_company_read" ON "osp_processes"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "osp_processes_manager_write" ON "osp_processes"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
