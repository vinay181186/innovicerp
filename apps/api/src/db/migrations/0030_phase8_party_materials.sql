-- ============================================================
-- 0030_phase8_party_materials
-- Store slice 1 — Party Material Master.
--
-- Catalogue of raw materials supplied by clients for Job Work orders.
-- Separate from regular items master — these belong to the client, not
-- the company. Stock is tracked independently (issued / received / on-hand)
-- and feeds Party Material GRN + JW DC workflows.
--
-- Mirrors legacy db.partyMaterials (renderPartyMaterial L24129).
-- Numbering: PM-NNNN (4-digit, zero-padded).
-- Idempotent — safe to re-run via _apply_0030.
-- ============================================================

CREATE TABLE IF NOT EXISTS "party_materials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "code" text NOT NULL,                                   -- e.g. PM-0001
  "name" text NOT NULL,
  "description" text,
  "material" text,                                        -- e.g. EN8, SS 304, MS
  "uom" text NOT NULL DEFAULT 'NOS',                      -- NOS / KG / MTR / SET / LOT
  "client_id" uuid REFERENCES "clients"("id") ON DELETE SET NULL,
  "client_code_text" text,
  "item_id" uuid REFERENCES "items"("id") ON DELETE SET NULL,
  "item_code_text" text,
  "stock_qty" integer NOT NULL DEFAULT 0,                 -- on-hand
  "issued_qty" integer NOT NULL DEFAULT 0,                -- cumulative
  "received_qty" integer NOT NULL DEFAULT 0,              -- cumulative

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,

  CONSTRAINT party_materials_stock_nonneg CHECK ("stock_qty" >= 0),
  CONSTRAINT party_materials_issued_nonneg CHECK ("issued_qty" >= 0),
  CONSTRAINT party_materials_received_nonneg CHECK ("received_qty" >= 0)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "party_materials_company_code_uniq"
  ON "party_materials" ("company_id", "code")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "party_materials_company_client_idx"
  ON "party_materials" ("company_id", "client_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "party_materials_company_item_idx"
  ON "party_materials" ("company_id", "item_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "party_materials" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "party_materials_company_read" ON "party_materials"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "party_materials_manager_write" ON "party_materials"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
