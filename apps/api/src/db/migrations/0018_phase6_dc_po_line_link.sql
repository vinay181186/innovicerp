-- ============================================================
-- 0018_phase6_dc_po_line_link
-- T-059a — link delivery_challan_lines to purchase_order_lines.
--
-- The outward DC flow ("printChallan" in legacy line 26133) creates
-- a DC against a JW PO and bumps jc_ops.outsource_sent_qty +
-- outsource_status on the linked jc_op. Until now, delivery_challan_lines
-- had only itemId (FK to items) — no direct link back to the PO line that
-- was being shipped against. createDeliveryChallan needs that link to
-- (a) find the jc_op via outsource_po_line_id for the cascade, and
-- (b) reverse the cascade cleanly on cancelDeliveryChallan.
--
-- Nullable so non-JW DCs (free-standing dispatch) still work — only
-- DCs issued against a JW PO populate the FK. ON DELETE SET NULL so a
-- purged PO doesn't break old DCs.
--
-- Idempotent — safe to re-run via apply-sql.ts.
-- ============================================================

ALTER TABLE "delivery_challan_lines"
  ADD COLUMN IF NOT EXISTS "purchase_order_line_id" uuid;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "delivery_challan_lines"
    ADD CONSTRAINT "delivery_challan_lines_po_line_id_fk"
    FOREIGN KEY ("purchase_order_line_id")
    REFERENCES "public"."purchase_order_lines"("id")
    ON DELETE SET NULL
    ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "delivery_challan_lines_po_line_idx"
  ON "delivery_challan_lines" USING btree ("purchase_order_line_id")
  WHERE "delivery_challan_lines"."purchase_order_line_id" IS NOT NULL;
