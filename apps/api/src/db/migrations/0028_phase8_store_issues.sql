-- ============================================================
-- 0028_phase8_store_issues
-- PL-II-1 / PL-SI-1 — Item Issue Register + Store Inventory.
--
-- Adds:
--   items.min_stock_qty   column  — drives low-stock alert in Store/Inventory
--                                    (legacy renderStore L24818: lowStock =
--                                    minQty>0 AND stockQty<=minQty).
--   store_issues          table   — daily-use consumable register.
--                                    Mirrors legacy db.storeIssues
--                                    (renderIssueRegister L23874).
--
-- Numbering: ISS-NNNNN (5-digit, zero-padded).
-- Issue write cascades into store_transactions (existing append-only ledger)
-- via service layer — DB-level we just need the row with FKs + audit envelope.
-- Idempotent — safe to re-run via _apply_0028.
-- ============================================================

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS min_stock_qty integer NOT NULL DEFAULT 0;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "store_issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "code" text NOT NULL,                                   -- e.g. ISS-00001
  "issue_date" date NOT NULL,
  "item_id" uuid REFERENCES "items"("id") ON DELETE SET NULL,
  "item_code_text" text,
  "item_name" text NOT NULL,
  "qty" integer NOT NULL,
  "issued_to" text NOT NULL,                              -- person / dept / machine
  "ref_type" text,                                        -- Job Card / SO / Production / Maintenance / Other
  "ref_no" text,                                          -- e.g. JC-00001
  "purpose" text,
  "remarks" text,
  "store_transaction_id" uuid REFERENCES "store_transactions"("id") ON DELETE SET NULL,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,

  CONSTRAINT store_issues_qty_positive CHECK ("qty" > 0)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "store_issues_company_code_uniq"
  ON "store_issues" ("company_id", "code")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "store_issues_company_date_idx"
  ON "store_issues" ("company_id", "issue_date")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "store_issues_company_item_idx"
  ON "store_issues" ("company_id", "item_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "store_issues" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "store_issues_company_read" ON "store_issues"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "store_issues_manager_write" ON "store_issues"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
