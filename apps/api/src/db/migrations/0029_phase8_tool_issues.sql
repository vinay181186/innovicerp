-- ============================================================
-- 0029_phase8_tool_issues
-- PL-TI-1 — Tool Issue Register (returnable items).
--
-- Adds two tables:
--   tool_issues          — header per tool issuance event.
--                          Numbering: TIS-NNNNN.
--                          Stock decrements on issue via store_transactions
--                          (txn_type='out', source_type='other',
--                          source_ref='TIS-NNNNN · CODE').
--   tool_issue_returns   — per-return event. Multiple returns can land
--                          against a single issue (partial returns). Good
--                          qty restores stock via a separate
--                          store_transactions IN row.
--
-- Status enum (issued | partial | returned) is stored as text — the small
-- domain doesn't justify a PG enum migration.
-- Idempotent — safe to re-run via _apply_0029.
-- ============================================================

CREATE TABLE IF NOT EXISTS "tool_issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "code" text NOT NULL,                                   -- e.g. TIS-00001
  "issue_date" date NOT NULL,
  "expected_return_date" date,
  "item_id" uuid REFERENCES "items"("id") ON DELETE SET NULL,
  "item_code_text" text,
  "item_name" text NOT NULL,
  "qty" integer NOT NULL,
  "issued_to" text NOT NULL,
  "ref_type" text,
  "ref_no" text,
  "purpose" text,
  "remarks" text,
  "return_status" text NOT NULL DEFAULT 'issued',         -- issued | partial | returned
  "return_good_qty" integer NOT NULL DEFAULT 0,           -- cumulative
  "return_damaged_qty" integer NOT NULL DEFAULT 0,
  "return_consumed_qty" integer NOT NULL DEFAULT 0,
  "store_transaction_id" uuid REFERENCES "store_transactions"("id") ON DELETE SET NULL,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,

  CONSTRAINT tool_issues_qty_positive CHECK ("qty" > 0),
  CONSTRAINT tool_issues_return_status_valid
    CHECK ("return_status" IN ('issued', 'partial', 'returned')),
  CONSTRAINT tool_issues_return_qtys_nonneg
    CHECK ("return_good_qty" >= 0 AND "return_damaged_qty" >= 0 AND "return_consumed_qty" >= 0),
  CONSTRAINT tool_issues_return_qtys_within_issue
    CHECK ("return_good_qty" + "return_damaged_qty" + "return_consumed_qty" <= "qty")
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "tool_issues_company_code_uniq"
  ON "tool_issues" ("company_id", "code")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "tool_issues_company_date_idx"
  ON "tool_issues" ("company_id", "issue_date")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "tool_issues_company_status_idx"
  ON "tool_issues" ("company_id", "return_status")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "tool_issues_overdue_idx"
  ON "tool_issues" ("company_id", "expected_return_date")
  WHERE "deleted_at" IS NULL
    AND "return_status" <> 'returned'
    AND "expected_return_date" IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "tool_issues" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "tool_issues_company_read" ON "tool_issues"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "tool_issues_manager_write" ON "tool_issues"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ─── tool_issue_returns ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "tool_issue_returns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "tool_issue_id" uuid NOT NULL REFERENCES "tool_issues"("id") ON DELETE CASCADE,
  "return_date" date NOT NULL,
  "returned_by" text,
  "good_qty" integer NOT NULL DEFAULT 0,
  "damaged_qty" integer NOT NULL DEFAULT 0,
  "consumed_qty" integer NOT NULL DEFAULT 0,
  "remarks" text,
  /** Linked store_transactions IN row for the Good qty (NULL when good=0). */
  "store_transaction_id" uuid REFERENCES "store_transactions"("id") ON DELETE SET NULL,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,

  CONSTRAINT tool_issue_returns_qtys_nonneg
    CHECK ("good_qty" >= 0 AND "damaged_qty" >= 0 AND "consumed_qty" >= 0),
  CONSTRAINT tool_issue_returns_any_qty
    CHECK ("good_qty" + "damaged_qty" + "consumed_qty" > 0)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "tool_issue_returns_issue_idx"
  ON "tool_issue_returns" ("tool_issue_id", "return_date")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "tool_issue_returns" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "tool_issue_returns_company_read" ON "tool_issue_returns"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "tool_issue_returns_manager_write" ON "tool_issue_returns"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
