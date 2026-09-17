-- 0134 — Item Master "Source": make or buy (ADR-171).
--
-- Bought-in items (bearings, fasteners, standard parts) were being pushed
-- through the production path — a plan, a route card marked "Direct
-- Purchase", an Execute — just to end up as one purchase request. Every
-- mainstream ERP settles this with a single flag on the item (SAP MRP
-- procurement type E/F, Odoo Manufacture/Buy routes), so this column is that
-- flag:
--
--   make (default — every existing item)  Planning → Plan → Production Order
--                                          → Route Card → Job Card.
--   buy                                    Planning line offers "+ PR"; a
--                                          standard purchase request is raised
--                                          against the SO line; stock arrives
--                                          through PO → GRN as today.
--
-- ADDITIVE: one column with a default and a CHECK, no data touched.
-- Idempotent — every step is guarded, so a re-run is a no-op.

ALTER TABLE items ADD COLUMN IF NOT EXISTS procurement_type text NOT NULL DEFAULT 'make';
--> statement-breakpoint

ALTER TABLE items DROP CONSTRAINT IF EXISTS items_procurement_type_check;
--> statement-breakpoint

ALTER TABLE items ADD CONSTRAINT items_procurement_type_check
  CHECK (procurement_type IN ('make', 'buy'));
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS items_company_procurement_idx
  ON items (company_id, procurement_type) WHERE deleted_at IS NULL;
