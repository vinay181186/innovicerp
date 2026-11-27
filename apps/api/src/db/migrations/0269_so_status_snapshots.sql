-- ============================================================
-- 0269_so_status_snapshots
-- ADR-325 (owner 2026-11-27) — SO / JWSO status by day.
--   so_status_snapshots — the saved copy of the 11 order-status figures,
--     one row per order (SO or JWSO) per IST day. Written by ONE writer:
--     the API timer (apps/api/src/modules/so-jwso-status/snapshot-job.ts),
--     every 10 minutes, for TODAY's IST date only. A past day is never
--     rewritten; a day with no rows reads "no saved copy" on the screen.
--   order_id has NO foreign key: it points at sales_orders (order_kind 'SO')
--     OR job_work_orders (order_kind 'JWSO'). order_code is the SO No. /
--     JWSO No. as it read when the copy was taken.
--   created_by / updated_by are NULLABLE on purpose: the writer is a system
--     timer with no signed-in user (same precedent as alert_deliveries,
--     0016). Rows written by the timer carry NULL there.
-- RLS: every user in the company may read; only an admin may write through
-- PostgREST. The API connects as postgres (RLS not enforced at runtime); the
-- service filters company_id on every query. NOT added to the realtime
-- publication (a history table, nobody watches it change).
-- Additive and idempotent — new table only, no data change.
-- Apply: DB_TARGET=TEST|PROD … tsx src/db/apply-sql.ts (see apply-sql.ts header).
-- ============================================================

CREATE TABLE IF NOT EXISTS "so_status_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "snap_date" date NOT NULL,
  "order_kind" text NOT NULL,
  "order_id" uuid NOT NULL,
  "order_code" text NOT NULL,
  "total_lines" integer NOT NULL DEFAULT 0,
  "total_plans" integer NOT NULL DEFAULT 0,
  "total_rc" integer NOT NULL DEFAULT 0,
  "pro_released" integer NOT NULL DEFAULT 0,
  "jc_released" integer NOT NULL DEFAULT 0,
  "jc_not_started" integer NOT NULL DEFAULT 0,
  "jc_running" integer NOT NULL DEFAULT 0,
  "jc_closed" integer NOT NULL DEFAULT 0,
  "pro_closed" integer NOT NULL DEFAULT 0,
  "dispatch_qty" numeric(14, 3) NOT NULL DEFAULT 0,
  "physical_stock" numeric(14, 3) NOT NULL DEFAULT 0,
  "taken_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid REFERENCES "users"("id"),
  "deleted_at" timestamptz,
  "deleted_by" uuid REFERENCES "users"("id"),
  CONSTRAINT "so_status_snapshots_order_kind_chk" CHECK ("order_kind" IN ('SO', 'JWSO'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "so_status_snapshots_day_order_uq"
  ON "so_status_snapshots" ("company_id", "snap_date", "order_kind", "order_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "so_status_snapshots_company_day_idx"
  ON "so_status_snapshots" ("company_id", "snap_date") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER so_status_snapshots_set_updated_at
  BEFORE UPDATE ON public.so_status_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
ALTER TABLE "so_status_snapshots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "so_status_snapshots_company_read" ON "so_status_snapshots"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "so_status_snapshots_admin_write" ON "so_status_snapshots"
    FOR ALL TO authenticated
    USING (current_user_role() = 'admin' AND company_id = current_company_id())
    WITH CHECK (current_user_role() = 'admin' AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------
-- DOWN (rollback reference only — NOT run by apply-sql; copy by hand).
--
-- DROP TABLE IF EXISTS "so_status_snapshots";
-- ------------------------------------------------------------
