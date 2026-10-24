-- ============================================================
-- 0217_cancel_requests
-- ADR-235 Phase A — ONE standard Cancel for documents. A live document is never
-- deleted, only Cancelled, and only after a Cancel Request is approved by a
-- holder of the Approve tick on the document's page.
--   1. cancel_requests — one row per Cancel Request. While 'pending' the
--      document is untouched (and its edit paths refuse, so nobody changes it
--      under the approver). Approving runs the document's own cancel worker in
--      the same transaction. The partial-unique index keeps ONE open request
--      per document. doc_type is a CHECK (not an enum) so a later phase widens
--      it by dropping + re-adding cancel_requests_doc_type_chk in a new
--      migration.
--   2. customer_dispatches.cancel_reason / cancelled_at / cancelled_by — the
--      reason on the cancelled row, as invoices and jw_invoices already carry.
--      Nullable; existing cancelled dispatches keep NULL (cancelled before the
--      reason was stored on the row — their reason is in the activity log).
--   3. cancel_requests joins the Realtime publication (same guard as 0209).
-- Additive and idempotent — new table, three new nullable columns. No data
-- change.
-- Apply: DB_TARGET=TEST|PROD … tsx src/db/apply-sql.ts (see apply-sql.ts header).
-- ============================================================

CREATE TABLE IF NOT EXISTS "cancel_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "doc_type" text NOT NULL,
  "doc_id" uuid NOT NULL,
  "doc_code" text NOT NULL,
  "reason" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "requested_by" uuid NOT NULL REFERENCES "users"("id"),
  "requested_at" timestamptz NOT NULL DEFAULT now(),
  "decided_by" uuid REFERENCES "users"("id"),
  "decided_at" timestamptz,
  "decision_note" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,
  "deleted_by" uuid REFERENCES "users"("id")
);
--> statement-breakpoint
-- Named CHECKs so a later phase can DROP CONSTRAINT … / ADD CONSTRAINT … to
-- enrol more document types (packages/shared CANCEL_DOC_TYPES is the list).
DO $$ BEGIN
  ALTER TABLE "cancel_requests" ADD CONSTRAINT "cancel_requests_doc_type_chk"
    CHECK ("doc_type" IN ('invoice', 'jw_invoice', 'customer_dispatch'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cancel_requests" ADD CONSTRAINT "cancel_requests_status_chk"
    CHECK ("status" IN ('pending', 'approved', 'rejected', 'withdrawn'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cancel_requests" ADD CONSTRAINT "cancel_requests_reason_chk"
    CHECK (length(btrim("reason")) > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
-- One open Cancel Request per document — a double click / two users at once
-- gets a 23505 here, answered as 409 "already pending".
CREATE UNIQUE INDEX IF NOT EXISTS "cancel_requests_pending_uq"
  ON "cancel_requests" ("doc_type", "doc_id")
  WHERE "status" = 'pending' AND "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cancel_requests_company_status_idx"
  ON "cancel_requests" ("company_id", "status", "requested_at")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "cancel_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "cancel_requests_company_read" ON "cancel_requests"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "cancel_requests_request_insert" ON "cancel_requests"
    FOR INSERT TO authenticated
    WITH CHECK (
      company_id = current_company_id()
      AND current_user_role() IN ('admin', 'manager', 'operator', 'qc', 'procurement', 'dispatch', 'design')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
-- Update by any authenticated user of the company: the API (BYPASSRLS, 0180)
-- checks the Approve tick itself (ADR-232); this only fences other companies.
DO $$ BEGIN
  CREATE POLICY "cancel_requests_decide" ON "cancel_requests"
    FOR UPDATE TO authenticated
    USING (company_id = current_company_id())
    WITH CHECK (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

ALTER TABLE "customer_dispatches" ADD COLUMN IF NOT EXISTS "cancel_reason" text;
--> statement-breakpoint
ALTER TABLE "customer_dispatches" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "customer_dispatches" ADD COLUMN IF NOT EXISTS "cancelled_by" uuid REFERENCES "users"("id");
--> statement-breakpoint

-- Realtime (ADR-230): same guards as 0205/0208/0209 — no-op without the
-- publication, skips an already-published table. The browser subscribes only
-- once packages/shared LIVE_TABLES lists cancel_requests.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'realtime: no supabase_realtime publication on this database — nothing to do';
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'cancel_requests'
  ) THEN
    RAISE NOTICE 'realtime: cancel_requests already published';
    RETURN;
  END IF;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.cancel_requests;
  RAISE NOTICE 'realtime: added cancel_requests';
END $$;

-- ------------------------------------------------------------
-- DOWN (rollback reference only — NOT run by apply-sql; copy by hand).
-- Destroys every Cancel Request row and the dispatch cancel reasons.
--
-- ALTER PUBLICATION supabase_realtime DROP TABLE public.cancel_requests;
-- ALTER TABLE "customer_dispatches" DROP COLUMN IF EXISTS "cancelled_by";
-- ALTER TABLE "customer_dispatches" DROP COLUMN IF EXISTS "cancelled_at";
-- ALTER TABLE "customer_dispatches" DROP COLUMN IF EXISTS "cancel_reason";
-- DROP TABLE IF EXISTS "cancel_requests";
-- ------------------------------------------------------------
