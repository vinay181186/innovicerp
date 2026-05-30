-- ============================================================
-- 0049_phase8_service_pos
-- Service Purchase Orders — separate from regular POs because they
-- cover non-inventory services (labour / maintenance / calibration /
-- testing / consultancy / etc.) with no line→item link, their own
-- approval flow, and a different print template. Mirror of legacy
-- db.servicePOs (renderServicePO L27504, _spoSave L27590).
-- Manager/admin writes; admin approves.
-- Idempotent.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE service_po_status AS ENUM ('draft', 'pending', 'approved', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE service_po_cost_center AS ENUM ('so', 'general');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE service_po_tax_type AS ENUM ('sgst_cgst', 'igst');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "service_pos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "spo_no" text NOT NULL,
  "spo_date" date NOT NULL,
  "vendor_id" uuid REFERENCES "vendors"("id"),
  "vendor_code_text" text,
  "expense_head" text NOT NULL DEFAULT 'Other',
  "cost_center" service_po_cost_center NOT NULL DEFAULT 'so',
  "so_ref_id" uuid REFERENCES "sales_orders"("id"),
  "so_no_text" text,
  "subtotal" numeric(14,2) NOT NULL DEFAULT 0,
  "tax_type" service_po_tax_type NOT NULL DEFAULT 'sgst_cgst',
  "gst_pct" numeric(5,2) NOT NULL DEFAULT 18,
  "tax_amount" numeric(14,2) NOT NULL DEFAULT 0,
  "total" numeric(14,2) NOT NULL DEFAULT 0,
  "payment_terms" text NOT NULL DEFAULT 'Immediate',
  "remarks" text,
  "status" service_po_status NOT NULL DEFAULT 'draft',
  "approved_by" uuid REFERENCES "users"("id"),
  "approved_at" timestamptz,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "service_pos_company_no_uq"
  ON "service_pos" ("company_id", "spo_no") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_pos_company_status_idx"
  ON "service_pos" ("company_id", "status") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_pos_company_date_idx"
  ON "service_pos" ("company_id", "spo_date") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_pos_vendor_idx"
  ON "service_pos" ("vendor_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "service_pos" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "service_pos_company_read" ON "service_pos"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "service_pos_manager_write" ON "service_pos"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ── Line items ──
CREATE TABLE IF NOT EXISTS "service_po_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "service_po_id" uuid NOT NULL REFERENCES "service_pos"("id") ON DELETE CASCADE,
  "line_no" integer NOT NULL,
  "description" text NOT NULL,
  "qty" numeric(12,2) NOT NULL DEFAULT 1,
  "rate" numeric(14,2) NOT NULL DEFAULT 0,
  "amount" numeric(14,2) NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id")
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "service_po_lines_po_lineno_uq"
  ON "service_po_lines" ("service_po_id", "line_no");
--> statement-breakpoint

ALTER TABLE "service_po_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "service_po_lines_company_read" ON "service_po_lines"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "service_po_lines_manager_write" ON "service_po_lines"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
