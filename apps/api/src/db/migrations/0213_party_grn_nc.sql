-- ============================================================
-- 0213_party_grn_nc.sql  (ADR-247 — Party GRN deviation raises an NC)
--
-- Customer material deviated at Party GRN Incoming QC now raises a material NC,
-- the same way a vendor GRN reject does (autoCreateMaterialNcFromIqcReject).
--   1. 'return_to_customer' added to the nc_disposition enum (customer-owned
--      pieces go back through IN-CMR, never to a vendor).
--   2. nc_register.party_grn_line_id — the Party GRN line the NC was raised on.
--   3. The "an NC needs a source" CHECK accepts that link as a third source.
--
-- ALTER TYPE ... ADD VALUE must be its own auto-committed statement; apply-sql
-- runs an enum-adding file statement by statement. Nothing below uses the new
-- value. Idempotent. Apply to BOTH test and production (release script).
-- Rollback: DROP the index + column, restore the two-source CHECK
--           (enum values cannot be removed; 'return_to_customer' stays unused).
-- ============================================================

ALTER TYPE nc_disposition ADD VALUE IF NOT EXISTS 'return_to_customer';
--> statement-breakpoint

ALTER TABLE "nc_register"
  ADD COLUMN IF NOT EXISTS "party_grn_line_id" uuid REFERENCES party_grn_lines(id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "nc_register_party_grn_line_idx"
  ON "nc_register" ("party_grn_line_id")
  WHERE party_grn_line_id IS NOT NULL AND deleted_at IS NULL;
--> statement-breakpoint

ALTER TABLE "nc_register" DROP CONSTRAINT IF EXISTS "nc_register_job_card_or_grn_line";
--> statement-breakpoint

ALTER TABLE "nc_register" ADD CONSTRAINT "nc_register_job_card_or_grn_line"
  CHECK (job_card_id IS NOT NULL OR grn_line_id IS NOT NULL OR party_grn_line_id IS NOT NULL);
