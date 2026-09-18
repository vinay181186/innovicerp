-- 0133 — Production Orders (IN-PRO-#####): the one document that turns a plan
-- into a Job Card, and the ONE moment finished goods are credited to stock.
--
-- Today a plan carries its own operations (plan_ops) and "Execute" copies them
-- onto a Job Card; stock is then credited piecemeal at up to three places —
-- the last op's QC accept, an OSP GRN's Incoming QC, or a terminal QC op
-- mirrored from Incoming QC. The user's new flow (2026-09-17):
--
--   Plan = qty + dates + raw material + remark, nothing else.
--   Route Card (Item Master) = the item's operations. No route card, no way forward.
--   Production Order = Plan + Route Card + Target Date → builds the Job Card.
--   Close Production Order (only once the JC is complete) → stock credited ONCE,
--   with the JC's actually finished qty (48 of a 50 plan credits 48).
--
-- What this migration adds, and why each piece:
--   plans.ops_source        'plan' (old flow, default — every existing row)
--                            or 'route_card' (new flow). Stored, not inferred,
--                            so an old ops-less planned plan is never mistaken
--                            for a new-flow plan; Execute is refused for
--                            'route_card' plans.
--   production_orders        the document itself; plan_id unique among live rows
--                            (one Production Order per plan; a big SO line just
--                            gets several plans).
--   job_cards.production_order_id  the switch the stock cascades read: a JC
--                            with this set writes NO qc_accept / grn_qc credit;
--                            its only credit is 'production_order_close'.
--   store_txn_source_type += 'production_order_close'.
--
-- Old plans, old JCs, plain purchase GRNs: untouched. No view changes.
--
-- Idempotent — every step is guarded, so a re-run is a no-op.
-- NOTE: the enum ADD VALUE must be committed before anything uses the value;
-- apply it as its own statement first (as done for 0122).

ALTER TYPE store_txn_source_type ADD VALUE IF NOT EXISTS 'production_order_close';
--> statement-breakpoint

ALTER TABLE plans ADD COLUMN IF NOT EXISTS ops_source text NOT NULL DEFAULT 'plan';
--> statement-breakpoint

ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_ops_source_check;
--> statement-breakpoint

ALTER TABLE plans ADD CONSTRAINT plans_ops_source_check
  CHECK (ops_source IN ('plan', 'route_card'));
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS production_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  code text NOT NULL,
  status text NOT NULL DEFAULT 'open',

  plan_id uuid NOT NULL REFERENCES plans(id),
  plan_code_text text NOT NULL,
  so_code_text text,
  line_no integer,

  item_id uuid NOT NULL REFERENCES items(id),
  item_code_text text NOT NULL,
  item_name_text text,

  route_card_id uuid NOT NULL REFERENCES route_cards(id),
  route_card_code_text text NOT NULL,
  route_card_revision integer NOT NULL DEFAULT 0,

  job_card_id uuid NOT NULL REFERENCES job_cards(id),
  jc_code_text text NOT NULL,

  order_qty integer NOT NULL,
  target_date date NOT NULL,

  closed_at timestamptz,
  closed_by uuid REFERENCES users(id),
  credited_qty integer,
  remarks text,

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES users(id),
  deleted_at timestamptz,

  CONSTRAINT production_orders_status_check CHECK (status IN ('open', 'closed')),
  CONSTRAINT production_orders_order_qty_check CHECK (order_qty > 0),
  CONSTRAINT production_orders_credited_qty_check CHECK (credited_qty IS NULL OR credited_qty >= 0)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS production_orders_company_code_uniq
  ON production_orders (company_id, code) WHERE deleted_at IS NULL;
--> statement-breakpoint

-- One Production Order per plan.
CREATE UNIQUE INDEX IF NOT EXISTS production_orders_plan_uniq
  ON production_orders (plan_id) WHERE deleted_at IS NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS production_orders_job_card_uniq
  ON production_orders (job_card_id) WHERE deleted_at IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS production_orders_company_status_idx
  ON production_orders (company_id, status) WHERE deleted_at IS NULL;
--> statement-breakpoint

ALTER TABLE production_orders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS production_orders_company_read ON production_orders;
--> statement-breakpoint

CREATE POLICY production_orders_company_read ON production_orders
  FOR SELECT TO authenticated
  USING (company_id = current_company_id());
--> statement-breakpoint

DROP POLICY IF EXISTS production_orders_manager_write ON production_orders;
--> statement-breakpoint

CREATE POLICY production_orders_manager_write ON production_orders
  FOR ALL TO authenticated
  USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
  WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
--> statement-breakpoint

ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS production_order_id uuid
  REFERENCES production_orders(id) ON DELETE SET NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS job_cards_production_order_idx
  ON job_cards (production_order_id) WHERE production_order_id IS NOT NULL;
