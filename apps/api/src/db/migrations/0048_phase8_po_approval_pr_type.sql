-- ============================================================
-- 0048_phase8_po_approval_pr_type
-- (a) Adds reject-side columns to purchase_orders so the Draft/Approve/
--     Reject flow per ADR-036 can run end-to-end. The approved_* cols
--     already exist (landed earlier); this just adds the mirror set
--     for reject.
-- (b) Adds pr_type to purchase_requests (enum: standard | jw_osp |
--     service). Legacy uses pr.prType to distinguish OSP PRs (auto-
--     created from JC ops) from regular PRs; we need the same to power
--     the new Outsource Jobs page.
--
-- Idempotent.
-- ============================================================

-- Reject-side metadata on POs.
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "rejected_by" uuid REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "rejected_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "rejection_reason" text;
--> statement-breakpoint

-- PR type enum.
DO $$ BEGIN
  CREATE TYPE pr_type AS ENUM ('standard', 'jw_osp', 'service');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

ALTER TABLE "purchase_requests" ADD COLUMN IF NOT EXISTS "pr_type" pr_type NOT NULL DEFAULT 'standard';
--> statement-breakpoint

-- Backfill: PRs that came from a JC op are JW_OSP per legacy convention.
UPDATE "purchase_requests"
SET "pr_type" = 'jw_osp'
WHERE "source_jc_op_id" IS NOT NULL
  AND "pr_type" = 'standard';
