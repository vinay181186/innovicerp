-- ============================================================
-- 0050_phase8_finance
-- Finance module (renderInvoices L21096, renderSOCosting L17249,
-- renderStockValuation L20927) + the customer-dispatch step the invoice
-- gate depends on (legacy dispatchLog / renderDispatchRegister).
--
-- (a) sales_order_lines.dispatched_qty — cumulative customer-dispatched
--     qty per line. Drives "pending dispatch" + invoice availability
--     (available to invoice = dispatched - invoiced). Service-maintained.
-- (b) machines.hour_rate — ₹/hr for the SO Costing machine-time component
--     (= cycle_min/60 * completed * hour_rate). Default 0.
-- (c) Flesh out invoices (table existed from 0027 but was unused/empty):
--     client snapshot, subtotal/GST, payment terms, due date, status.
-- (d) invoice_payments — one row per receipt against an invoice.
-- (e) customer_dispatches (+ _lines) — dispatch of ready (produced +
--     QC-accepted) qty against SO lines; the customer Dispatch Register.
--
-- All additive + idempotent. Existing rows are untouched (new columns are
-- nullable or have safe defaults; invoices is empty pre-Finance).
-- ============================================================

-- (a) Per-SO-line dispatched qty.
ALTER TABLE "sales_order_lines" ADD COLUMN IF NOT EXISTS "dispatched_qty" integer NOT NULL DEFAULT 0;
--> statement-breakpoint

-- (b) Machine hourly rate (SO costing).
ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "hour_rate" numeric(12,2) NOT NULL DEFAULT 0;
--> statement-breakpoint

-- (c) Invoice status enum + invoice columns.
DO $$ BEGIN
  CREATE TYPE invoice_status AS ENUM ('unpaid', 'partial', 'paid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "client_id" uuid REFERENCES "clients"("id");
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "client_name_text" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "client_code_text" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "client_gst_text" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "subtotal" numeric(14,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "gst_percent" numeric(5,2) NOT NULL DEFAULT 18;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "gst_amount" numeric(14,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "payment_terms_days" integer NOT NULL DEFAULT 45;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "due_date" date;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "status" invoice_status NOT NULL DEFAULT 'unpaid';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_company_status_idx"
  ON "invoices" ("company_id", "status") WHERE "deleted_at" IS NULL;
--> statement-breakpoint

-- (d) Invoice payments.
CREATE TABLE IF NOT EXISTS "invoice_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "invoice_id" uuid NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
  "payment_date" date NOT NULL,
  "amount" numeric(14,2) NOT NULL,
  "mode" text NOT NULL DEFAULT 'NEFT',
  "ref_no" text,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_payments_invoice_idx"
  ON "invoice_payments" ("invoice_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "invoice_payments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "invoice_payments_company_read" ON "invoice_payments"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "invoice_payments_manager_write" ON "invoice_payments"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- (e) Customer dispatch.
DO $$ BEGIN
  CREATE TYPE customer_dispatch_status AS ENUM ('dispatched', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "customer_dispatches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "code" text NOT NULL,
  "dispatch_date" date NOT NULL,
  "sales_order_id" uuid NOT NULL REFERENCES "sales_orders"("id"),
  "so_code_text" text,
  "customer_text" text,
  "transport" text,
  "vehicle_no" text,
  "status" customer_dispatch_status NOT NULL DEFAULT 'dispatched',
  "remarks" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customer_dispatches_company_code_uq"
  ON "customer_dispatches" ("company_id", "code") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_dispatches_company_so_idx"
  ON "customer_dispatches" ("company_id", "sales_order_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_dispatches_company_date_idx"
  ON "customer_dispatches" ("company_id", "dispatch_date") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "customer_dispatches" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "customer_dispatches_company_read" ON "customer_dispatches"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "customer_dispatches_manager_write" ON "customer_dispatches"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "customer_dispatch_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "customer_dispatch_id" uuid NOT NULL REFERENCES "customer_dispatches"("id") ON DELETE CASCADE,
  "line_no" integer NOT NULL,
  "sales_order_line_id" uuid REFERENCES "sales_order_lines"("id") ON DELETE SET NULL,
  "item_id" uuid REFERENCES "items"("id") ON DELETE SET NULL,
  "item_code_text" text,
  "item_name" text NOT NULL,
  "qty" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,
  CONSTRAINT "customer_dispatch_lines_qty_positive" CHECK ("qty" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customer_dispatch_lines_line_uq"
  ON "customer_dispatch_lines" ("customer_dispatch_id", "line_no") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_dispatch_lines_so_line_idx"
  ON "customer_dispatch_lines" ("sales_order_line_id")
  WHERE "sales_order_line_id" IS NOT NULL AND "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "customer_dispatch_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "customer_dispatch_lines_company_read" ON "customer_dispatch_lines"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "customer_dispatch_lines_manager_write" ON "customer_dispatch_lines"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
