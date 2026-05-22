-- ============================================================
-- 0027_phase8_invoices
-- PL-PSV-1 — Pending SO Value report (sales-side revenue tracker).
--
-- Mirrors legacy renderPendingSOValue (HTML L19272) which consumes
-- `db.invoices[]`. Migration introduces two read-mostly tables:
--   invoices       — one row per customer invoice issued against an SO.
--   invoice_lines  — per-line item + qty + rate + amount.
--
-- A new SO field invoice_no is NOT added (invoices link back to SOs
-- via invoices.sales_order_id). totalPaid is stored on the invoice
-- header for simplicity in this slice; richer payment-receipt history
-- can land later as a separate `invoice_payments` table.
--
-- Both tables get standard audit envelope + RLS company_read + manager_write.
-- Idempotent — safe to re-run via _apply_0027.
-- ============================================================

CREATE TABLE IF NOT EXISTS "invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "code" text NOT NULL,                                  -- e.g. INV-00001
  "invoice_date" date NOT NULL,
  "sales_order_id" uuid NOT NULL REFERENCES "sales_orders"("id") ON DELETE CASCADE,
  "so_code_text" text,                                   -- denorm for fast list-view scans
  "grand_total" numeric(14, 2) NOT NULL DEFAULT '0',
  "total_paid" numeric(14, 2) NOT NULL DEFAULT '0',
  "remarks" text,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,

  CONSTRAINT invoices_amounts_nonneg
    CHECK ("grand_total" >= 0 AND "total_paid" >= 0)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "invoices_company_code_uniq"
  ON "invoices" ("company_id", "code")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "invoices_company_so_idx"
  ON "invoices" ("company_id", "sales_order_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "invoices_company_date_idx"
  ON "invoices" ("company_id", "invoice_date")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "invoices_company_read" ON "invoices"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "invoices_manager_write" ON "invoices"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ─── invoice_lines ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "invoice_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "invoice_id" uuid NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
  "line_no" integer NOT NULL,
  "item_id" uuid REFERENCES "items"("id") ON DELETE SET NULL,
  "item_code_text" text,
  "item_name" text NOT NULL,
  "qty" integer NOT NULL,
  "rate" numeric(12, 2) NOT NULL DEFAULT '0',
  "line_amount" numeric(14, 2) NOT NULL DEFAULT '0',
  "sales_order_line_id" uuid REFERENCES "sales_order_lines"("id") ON DELETE SET NULL,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,

  CONSTRAINT invoice_lines_qty_positive CHECK ("qty" > 0),
  CONSTRAINT invoice_lines_rate_nonneg CHECK ("rate" >= 0)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "invoice_lines_invoice_line_uniq"
  ON "invoice_lines" ("invoice_id", "line_no")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "invoice_lines_so_line_idx"
  ON "invoice_lines" ("sales_order_line_id")
  WHERE "sales_order_line_id" IS NOT NULL AND "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "invoice_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "invoice_lines_company_read" ON "invoice_lines"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "invoice_lines_manager_write" ON "invoice_lines"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
