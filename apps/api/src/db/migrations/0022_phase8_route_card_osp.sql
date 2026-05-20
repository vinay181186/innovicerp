-- ============================================================
-- 0022_phase8_route_card_osp
-- RC-1 (Phase A item 2 of LEGACY_AUDIT.md build plan — Route Cards).
-- Adds OSP-step fields to route_card_ops so route-card ops with
-- op_type='outsource' can carry the legacy ospVendorCode/
-- ospVendor/ospLeadDays values (legacy/InnovicERP_v82_12_3.html
-- L6961 _rcAutoFillOspVendor / L7008+ saveRouteCardForItem).
--
-- Three nullable columns:
--   osp_vendor_id         uuid FK → vendors(id), nullable.
--                         Live FK when the legacy ospVendorCode
--                         resolves to a vendor in the master.
--   osp_vendor_code_text  text, nullable. Free-text fallback per
--                         ADR-012 #10 — preserves legacy free-
--                         text values that don't resolve to a
--                         vendor row.
--   osp_lead_days         integer, nullable. Days between issuing
--                         an outside-process PO and expected
--                         return. Legacy default 5 (L10229).
--
-- No CHECK constraint enforcing "outsource ops MUST have vendor"
-- here — service-layer Zod refine handles the conditional
-- requirement so we keep partially-filled drafts editable.
--
-- Idempotent — safe to re-run via _apply_0022 applier.
-- ============================================================

ALTER TABLE "route_card_ops"
  ADD COLUMN IF NOT EXISTS "osp_vendor_id" uuid;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "route_card_ops"
    ADD CONSTRAINT "route_card_ops_osp_vendor_fk"
    FOREIGN KEY ("osp_vendor_id")
    REFERENCES "public"."vendors"("id")
    ON DELETE SET NULL
    ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

ALTER TABLE "route_card_ops"
  ADD COLUMN IF NOT EXISTS "osp_vendor_code_text" text;
--> statement-breakpoint

ALTER TABLE "route_card_ops"
  ADD COLUMN IF NOT EXISTS "osp_lead_days" integer;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "route_card_ops_osp_vendor_idx"
  ON "route_card_ops" ("osp_vendor_id")
  WHERE "osp_vendor_id" IS NOT NULL;
