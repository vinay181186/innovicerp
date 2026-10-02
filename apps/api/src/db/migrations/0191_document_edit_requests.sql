-- ============================================================
-- 0191_document_edit_requests
-- Edit-approval, Phase 1 (ADR-202). Every edit to a LIVE document — this phase
-- Purchase Order only — is STAGED for per-change approval instead of applied.
--   1. document_edit_status enum (pending | approved | rejected | withdrawn |
--      superseded).
--   2. document_edit_requests — one staged edit per document, modeled on
--      op_log_time_change_requests: the live document is untouched while
--      'pending'; approving applies the approved + still-fresh changes, the
--      partial-unique index keeps one open edit per document.
--   3. approval_config.doc_edit_approval — the on/off gate (default OFF).
-- Additive and idempotent — new type, new table, one new nullable-by-default
-- column. No data change.
-- Apply: DB_TARGET=TEST|PROD … tsx src/db/apply-sql.ts (see apply-sql.ts header).
-- ============================================================

DO $$ BEGIN
  CREATE TYPE document_edit_status AS ENUM ('pending', 'approved', 'rejected', 'withdrawn', 'superseded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "document_edit_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "entity" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "doc_code" text NOT NULL,
  "expected_updated_at" timestamptz NOT NULL,
  "proposed_payload" jsonb NOT NULL,
  "changes" jsonb NOT NULL,
  "decisions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" document_edit_status NOT NULL DEFAULT 'pending',
  "requested_by" uuid NOT NULL REFERENCES "users"("id"),
  "requested_at" timestamptz NOT NULL DEFAULT now(),
  "decided_by" uuid REFERENCES "users"("id"),
  "decided_at" timestamptz,
  "decision_reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,
  "deleted_by" uuid REFERENCES "users"("id")
);
--> statement-breakpoint
-- One open edit per document — a second edit before the first is decided would
-- stage two conflicting payloads and the last approval would win.
CREATE UNIQUE INDEX IF NOT EXISTS "document_edit_pending_uq"
  ON "document_edit_requests" ("entity", "entity_id")
  WHERE "status" = 'pending' AND "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_edit_company_status_idx"
  ON "document_edit_requests" ("company_id", "status", "requested_at")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_edit_entity_idx"
  ON "document_edit_requests" ("entity", "entity_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "document_edit_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "document_edit_company_read" ON "document_edit_requests"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "document_edit_request_insert" ON "document_edit_requests"
    FOR INSERT TO authenticated
    WITH CHECK (
      company_id = current_company_id()
      AND current_user_role() IN ('admin', 'manager', 'operator', 'qc', 'procurement', 'dispatch', 'design')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "document_edit_decide" ON "document_edit_requests"
    FOR UPDATE TO authenticated
    USING (company_id = current_company_id() AND current_user_role() IN ('admin', 'manager'))
    WITH CHECK (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

ALTER TABLE "approval_config"
  ADD COLUMN IF NOT EXISTS "doc_edit_approval" boolean NOT NULL DEFAULT false;

-- ------------------------------------------------------------
-- DOWN (rollback reference only — NOT run by apply-sql; copy by hand).
-- Destroys every staged edit request.
--
-- ALTER TABLE "approval_config" DROP COLUMN IF EXISTS "doc_edit_approval";
-- DROP POLICY IF EXISTS "document_edit_decide" ON "document_edit_requests";
-- DROP POLICY IF EXISTS "document_edit_request_insert" ON "document_edit_requests";
-- DROP POLICY IF EXISTS "document_edit_company_read" ON "document_edit_requests";
-- DROP TABLE IF EXISTS "document_edit_requests";
-- DROP TYPE IF EXISTS document_edit_status;
-- ------------------------------------------------------------
