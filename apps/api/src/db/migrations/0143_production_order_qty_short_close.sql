-- 0143 — Production Orders: many orders per plan (qty-capped), raw-material
-- confirmation + actual size, and Short Close at any stage (ADR-182).
--
-- Until now a plan could raise exactly ONE production order and that order
-- silently took the whole plan qty (`order_qty = plans.plan_qty`, unique index
-- `production_orders_plan_uniq`). The user (2026-09-24) wants a plan of 50 to
-- be coverable by several orders — 20 + 20 leaves 10, a third order of 30 is
-- refused — and wants the shop floor to confirm material before an order is
-- raised, recording the size actually cut. And an order must be stoppable at
-- ANY stage ("short close"): nothing further may be done on it and the
-- un-produced balance goes back to the plan's pending qty.
--
-- What this adds:
--   raw_material_available  the mandatory tick on Create ("Raw material
--                           available"). Existing rows are backfilled TRUE —
--                           they were raised before the tick existed.
--   actual_size             free text, the size actually available / cut.
--                           Snapshot on the order and copied onto its Job Card
--                           the same way grade / size snapshots already are.
--   short_closed_at/_by     who stopped the order and when.
--   short_close_reason      why. The CHECK makes it mandatory for the status,
--                           mirroring 0117's purchase-request short close.
--   status 'short_closed'   a fourth value; the CHECK is rewritten.
--   DROP production_orders_plan_uniq   a plan may now have many orders; the
--                           server caps SUM(order_qty) against plans.plan_qty
--                           inside the existing plan row lock.
--
-- job_cards.actual_size     the same text carried to the card the order built,
--                           so the traveller prints what was really cut.
--
-- Idempotent — every step is guarded, so a re-run is a no-op.

ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS raw_material_available boolean NOT NULL DEFAULT true;
--> statement-breakpoint

ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS actual_size text;
--> statement-breakpoint

ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS short_closed_at timestamptz;
--> statement-breakpoint

ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS short_closed_by uuid REFERENCES users(id);
--> statement-breakpoint

ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS short_close_reason text;
--> statement-breakpoint

ALTER TABLE production_orders DROP CONSTRAINT IF EXISTS production_orders_status_check;
--> statement-breakpoint

ALTER TABLE production_orders ADD CONSTRAINT production_orders_status_check
  CHECK (status IN ('open', 'partially_closed', 'closed', 'short_closed'));
--> statement-breakpoint

-- A short-closed order must say who stopped it, when, and why (0117 shape).
ALTER TABLE production_orders DROP CONSTRAINT IF EXISTS production_orders_short_close_check;
--> statement-breakpoint

ALTER TABLE production_orders ADD CONSTRAINT production_orders_short_close_check
  CHECK (
    status <> 'short_closed'
    OR (short_closed_at IS NOT NULL AND short_closed_by IS NOT NULL
        AND short_close_reason IS NOT NULL AND btrim(short_close_reason) <> '')
  );
--> statement-breakpoint

-- Many orders per plan, capped by the server against plans.plan_qty.
DROP INDEX IF EXISTS production_orders_plan_uniq;
--> statement-breakpoint

-- The cap's read path: every live order of one plan.
CREATE INDEX IF NOT EXISTS production_orders_plan_idx
  ON production_orders (plan_id) WHERE deleted_at IS NULL;
--> statement-breakpoint

ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS actual_size text;
