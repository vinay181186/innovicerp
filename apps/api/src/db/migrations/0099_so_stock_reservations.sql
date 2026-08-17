-- ============================================================
-- 0099_so_stock_reservations
-- Stage 1 of SO stock reservation. Lets a planner BOOK on-hand finished-goods
-- stock to a specific SO line ("hard move"): reserving posts a
-- store_transactions 'out' row that debits general stock and records a
-- so_stock_reservations row; releasing posts the matching 'in' and flips the
-- row to 'released'. Dispatching the reserved qty (Stage 3) flips it to
-- 'dispatched' without a second stock move.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- New store-transaction source. ADD VALUE runs outside a txn block (the
-- apply-sql runner executes each statement on its own), so it commits before
-- anything below could use it.
ALTER TYPE store_txn_source_type ADD VALUE IF NOT EXISTS 'reservation';
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "so_stock_reservations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  -- The planning line this reserves against. For an SO plan this is the SO line
  -- id; for a JW plan it is the JW line id (mirrors plans.so_line_id usage).
  "so_line_id" uuid NOT NULL,
  "so_code_text" text NOT NULL,
  "line_no" integer NOT NULL,
  "item_id" uuid NOT NULL REFERENCES "items"("id"),
  "item_code_text" text,
  "qty" integer NOT NULL,
  -- 'active' = holding stock; 'released' = returned to general stock;
  -- 'dispatched' = shipped against the SO (Stage 3).
  "status" text NOT NULL DEFAULT 'active',
  "remarks" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,
  CONSTRAINT "so_stock_reservations_qty_positive" CHECK ("qty" > 0),
  CONSTRAINT "so_stock_reservations_status_valid"
    CHECK ("status" IN ('active', 'released', 'dispatched'))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "so_stock_reservations_company_line_idx"
  ON "so_stock_reservations" ("company_id", "so_line_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "so_stock_reservations_company_item_idx"
  ON "so_stock_reservations" ("company_id", "item_id");
--> statement-breakpoint

ALTER TABLE "so_stock_reservations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "so_stock_reservations_company_read" ON "so_stock_reservations"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "so_stock_reservations_manager_write" ON "so_stock_reservations"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
