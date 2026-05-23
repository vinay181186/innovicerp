-- ============================================================
-- 0031_phase8_party_grn
-- Store slice 2 — Party Material GRN (header + lines).
--
-- Records client-supplied raw material received against a JW order.
-- Inverse of regular GRN (vendor→us); here client→us via JW.
-- Multi-line per receipt — one DC from a client may bring multiple
-- materials.
--
-- Mirrors legacy db.partyGrn (renderPartyGRN HTML L24251) + addPartyGRN
-- (L24298). Numbering: PGRN-NNNNN.
--
-- Save cascade (in service): each line increments
--   party_materials.stock_qty + party_materials.received_qty.
--
-- Idempotent — safe to re-run via _apply_0031.
-- ============================================================

CREATE TABLE IF NOT EXISTS "party_grn" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "code" text NOT NULL,                                   -- e.g. PGRN-00001
  "grn_date" date NOT NULL,

  -- JW + Client snapshot (header-level — denormalised for query speed).
  "job_work_order_id" uuid REFERENCES "job_work_orders"("id") ON DELETE SET NULL,
  "jw_code_text" text,
  "client_id" uuid REFERENCES "clients"("id") ON DELETE SET NULL,
  "client_code_text" text,
  "client_po_no" text,

  "dc_no" text,                                           -- DC / Challan No.
  "remarks" text,
  "received_by_text" text,                                -- snapshot of user.name

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "party_grn_company_code_uniq"
  ON "party_grn" ("company_id", "code")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "party_grn_company_date_idx"
  ON "party_grn" ("company_id", "grn_date")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "party_grn_company_jw_idx"
  ON "party_grn" ("company_id", "job_work_order_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "party_grn_company_client_idx"
  ON "party_grn" ("company_id", "client_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "party_grn" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "party_grn_company_read" ON "party_grn"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "party_grn_manager_write" ON "party_grn"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ─── party_grn_lines ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "party_grn_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "party_grn_id" uuid NOT NULL REFERENCES "party_grn"("id") ON DELETE CASCADE,
  "line_no" integer NOT NULL,

  "party_material_id" uuid REFERENCES "party_materials"("id") ON DELETE SET NULL,
  "party_material_code_text" text NOT NULL,
  "party_material_name" text,

  "received_qty" integer NOT NULL,
  "jw_line_no_text" text,
  "remarks" text,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,

  CONSTRAINT party_grn_lines_qty_positive CHECK ("received_qty" > 0)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "party_grn_lines_grn_idx"
  ON "party_grn_lines" ("party_grn_id", "line_no")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "party_grn_lines_material_idx"
  ON "party_grn_lines" ("party_material_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "party_grn_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "party_grn_lines_company_read" ON "party_grn_lines"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "party_grn_lines_manager_write" ON "party_grn_lines"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
