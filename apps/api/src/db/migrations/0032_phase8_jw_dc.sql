-- ============================================================
-- 0032_phase8_jw_dc
-- Store slice 3 — JW Delivery Challan (4 tables).
--
-- Tracks material movement to/from JW vendors:
--   jw_dc_outward        — header per outward DC (Returnable Gate Pass).
--                          Numbering: JWDC-OUT-NNNN.
--   jw_dc_outward_lines  — per-PO-line dispatch.
--   jw_dc_inward         — header per inward (return) entry.
--                          Numbering: JWIN-NNNN.
--   jw_dc_inward_lines   — per-outward-line return event with OK/Rejected split.
--
-- Save cascades (in service):
--   Outward line save: items.stock_qty -= sentQty (clamped to 0); emit
--     store_transactions(txn_type='out', source_type='jw_out',
--                        source_ref='<dcNo> · <itemCode>').
--   Inward line save (per ok qty): items.stock_qty += okQty; emit
--     store_transactions(txn_type='in', source_type='jw_in',
--                        source_ref='<inwardNo> · <itemCode>').
--   Rejected qty deferred — auto-NC creation is a follow-up hook (left as
--   stored data only for now).
--
-- Mirrors legacy db.jwDCOutward + db.jwDCInward
-- (renderJWDC HTML L24434 + _jwdcNewOutward L24489 + _jwdcNewInward L24692).
-- Idempotent — safe to re-run via _apply_0032.
-- ============================================================

CREATE TABLE IF NOT EXISTS "jw_dc_outward" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "code" text NOT NULL,                                   -- e.g. JWDC-OUT-0001
  "dc_date" date NOT NULL,

  -- Linked JWPO (PO with po_type='job_work').
  "purchase_order_id" uuid REFERENCES "purchase_orders"("id") ON DELETE SET NULL,
  "jwpo_code_text" text,
  "vendor_id" uuid REFERENCES "vendors"("id") ON DELETE SET NULL,
  "vendor_code_text" text,
  "vendor_name_text" text,

  "vehicle_no" text,
  "remarks" text,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "jw_dc_outward_company_code_uniq"
  ON "jw_dc_outward" ("company_id", "code")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "jw_dc_outward_company_date_idx"
  ON "jw_dc_outward" ("company_id", "dc_date")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "jw_dc_outward_company_po_idx"
  ON "jw_dc_outward" ("company_id", "purchase_order_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "jw_dc_outward_company_vendor_idx"
  ON "jw_dc_outward" ("company_id", "vendor_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "jw_dc_outward" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "jw_dc_outward_company_read" ON "jw_dc_outward"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "jw_dc_outward_manager_write" ON "jw_dc_outward"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ─── jw_dc_outward_lines ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "jw_dc_outward_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "jw_dc_outward_id" uuid NOT NULL REFERENCES "jw_dc_outward"("id") ON DELETE CASCADE,
  "line_no" integer NOT NULL,

  "purchase_order_line_id" uuid REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL,
  "item_id" uuid REFERENCES "items"("id") ON DELETE SET NULL,
  "item_code_text" text NOT NULL,
  "item_name_text" text,
  "process_text" text,                                    -- from PO line remarks
  "po_qty" integer NOT NULL DEFAULT 0,
  "sent_qty" integer NOT NULL,

  "store_transaction_id" uuid REFERENCES "store_transactions"("id") ON DELETE SET NULL,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,

  CONSTRAINT jw_dc_outward_lines_qty_positive CHECK ("sent_qty" > 0)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "jw_dc_outward_lines_dc_idx"
  ON "jw_dc_outward_lines" ("jw_dc_outward_id", "line_no")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "jw_dc_outward_lines_po_line_idx"
  ON "jw_dc_outward_lines" ("purchase_order_line_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "jw_dc_outward_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "jw_dc_outward_lines_company_read" ON "jw_dc_outward_lines"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "jw_dc_outward_lines_manager_write" ON "jw_dc_outward_lines"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ─── jw_dc_inward ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "jw_dc_inward" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "code" text NOT NULL,                                   -- e.g. JWIN-0001
  "inward_date" date NOT NULL,

  "jw_dc_outward_id" uuid NOT NULL REFERENCES "jw_dc_outward"("id") ON DELETE RESTRICT,
  "dc_code_text" text,                                    -- snapshot of outward.code

  "vendor_challan_no" text,
  "vehicle_no" text,
  "remarks" text,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "jw_dc_inward_company_code_uniq"
  ON "jw_dc_inward" ("company_id", "code")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "jw_dc_inward_company_date_idx"
  ON "jw_dc_inward" ("company_id", "inward_date")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "jw_dc_inward_company_dc_idx"
  ON "jw_dc_inward" ("company_id", "jw_dc_outward_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "jw_dc_inward" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "jw_dc_inward_company_read" ON "jw_dc_inward"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "jw_dc_inward_manager_write" ON "jw_dc_inward"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ─── jw_dc_inward_lines ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "jw_dc_inward_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "jw_dc_inward_id" uuid NOT NULL REFERENCES "jw_dc_inward"("id") ON DELETE CASCADE,

  -- Tied to the outward line being returned against (legacy `dcLineIdx`).
  "jw_dc_outward_line_id" uuid NOT NULL REFERENCES "jw_dc_outward_lines"("id") ON DELETE RESTRICT,

  "item_id" uuid REFERENCES "items"("id") ON DELETE SET NULL,
  "item_code_text" text NOT NULL,
  "item_name_text" text,
  "process_text" text,
  "sent_qty" integer NOT NULL DEFAULT 0,                  -- snapshot at receipt time
  "received_qty" integer NOT NULL,
  "ok_qty" integer NOT NULL DEFAULT 0,
  "rejected_qty" integer NOT NULL DEFAULT 0,
  "remarks" text,

  "store_transaction_id" uuid REFERENCES "store_transactions"("id") ON DELETE SET NULL,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,

  CONSTRAINT jw_dc_inward_lines_received_positive CHECK ("received_qty" > 0),
  CONSTRAINT jw_dc_inward_lines_ok_nonneg CHECK ("ok_qty" >= 0),
  CONSTRAINT jw_dc_inward_lines_rej_nonneg CHECK ("rejected_qty" >= 0),
  CONSTRAINT jw_dc_inward_lines_split_total
    CHECK ("ok_qty" + "rejected_qty" = "received_qty")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "jw_dc_inward_lines_inward_idx"
  ON "jw_dc_inward_lines" ("jw_dc_inward_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "jw_dc_inward_lines_outward_line_idx"
  ON "jw_dc_inward_lines" ("jw_dc_outward_line_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "jw_dc_inward_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "jw_dc_inward_lines_company_read" ON "jw_dc_inward_lines"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "jw_dc_inward_lines_manager_write" ON "jw_dc_inward_lines"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
