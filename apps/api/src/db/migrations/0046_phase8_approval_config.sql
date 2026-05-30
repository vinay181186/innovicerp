-- ============================================================
-- 0046_phase8_approval_config
-- Approval Configuration — admin-controlled toggles + limits for the
-- PO/PR/Invoice approval flow. Mirror of legacy db.approvalConfig +
-- per-user approvalLimit (renderApprovalConfig HTML L21608; helpers
-- _getApprovalConfig L21582, _isPoApprover L21591). Admin-only writes.
--
-- DELTA: legacy storage was a single JSON blob in localStorage; we
-- promote to one row per company in a typed table + a per-user numeric
-- column on `users`. The actual draft/approve/reject flow on POs is
-- a separate slice — this migration only lands the config surface.
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS "approval_config" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "po_approval" boolean NOT NULL DEFAULT true,
  "po_manager_limit" numeric(14,2) NOT NULL DEFAULT 100000,
  "pr_approval" boolean NOT NULL DEFAULT true,
  "invoice_approval" boolean NOT NULL DEFAULT false,
  "po_approvers" jsonb NOT NULL DEFAULT '[]'::jsonb,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz
);
--> statement-breakpoint

-- One active row per company.
CREATE UNIQUE INDEX IF NOT EXISTS "approval_config_company_uq"
  ON "approval_config" ("company_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "approval_config" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "approval_config_company_read" ON "approval_config"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "approval_config_admin_write" ON "approval_config"
    FOR ALL TO authenticated
    USING (current_user_role() = 'admin' AND company_id = current_company_id())
    WITH CHECK (current_user_role() = 'admin' AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Per-user PO approval limit. NULL ⇒ fall back to approval_config.po_manager_limit
-- for non-admin approvers (admin always unlimited per service-layer check).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "approval_limit" numeric(14,2);
