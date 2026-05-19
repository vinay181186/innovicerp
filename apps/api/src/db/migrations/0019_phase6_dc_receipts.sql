-- ============================================================
-- 0019_phase6_dc_receipts
-- T-059b — outsource DC receive-back: receipts header + lines + view update.
--
-- Receipts are many-per-outward-line (partial receives over time); each
-- receipt records received + rejected qty per outward line, with auto-NC
-- on rejected qty handled at the service layer. The v_jc_op_status view
-- is patched to:
--   (1) project computed_status='complete' on outsource ops whose
--       outsource_status='received' (driven by cascade on full reconcile)
--   (2) feed prev_output CTE with received - rejected for outsource ops so
--       the next op's input_avail reflects what actually came back, not
--       completed_qty (always 0 for outsource).
--
-- Idempotent — safe to re-run via _apply_0019 applier.
-- ============================================================

-- ─── delivery_challan_receipts ────────────────────────────────
CREATE TABLE IF NOT EXISTS "delivery_challan_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "delivery_challan_id" uuid NOT NULL REFERENCES "delivery_challans"("id") ON DELETE CASCADE,
  "receipt_code" text NOT NULL,
  "receipt_date" date NOT NULL,
  "vendor_invoice_text" text,
  "remarks" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "delivery_challan_receipts_company_code_uniq"
  ON "delivery_challan_receipts" ("company_id", "receipt_code")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "delivery_challan_receipts_dc_idx"
  ON "delivery_challan_receipts" ("delivery_challan_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "delivery_challan_receipts_company_date_idx"
  ON "delivery_challan_receipts" ("company_id", "receipt_date")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "delivery_challan_receipts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "delivery_challan_receipts_company_read" ON "delivery_challan_receipts"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "delivery_challan_receipts_manager_write" ON "delivery_challan_receipts"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ─── delivery_challan_receipt_lines ───────────────────────────
CREATE TABLE IF NOT EXISTS "delivery_challan_receipt_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "receipt_id" uuid NOT NULL REFERENCES "delivery_challan_receipts"("id") ON DELETE CASCADE,
  "delivery_challan_line_id" uuid NOT NULL REFERENCES "delivery_challan_lines"("id") ON DELETE CASCADE,
  "received_qty" numeric(12,2) NOT NULL,
  "rejected_qty" numeric(12,2) NOT NULL DEFAULT 0,
  "reject_reason" text,
  "remarks" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,
  CONSTRAINT "dcr_lines_qty_nonneg" CHECK ("received_qty" >= 0 AND "rejected_qty" >= 0),
  CONSTRAINT "dcr_lines_qty_positive_sum" CHECK ("received_qty" + "rejected_qty" > 0),
  CONSTRAINT "dcr_lines_reject_reason_when_rejected" CHECK ("rejected_qty" = 0 OR "reject_reason" IS NOT NULL)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "delivery_challan_receipt_lines_receipt_idx"
  ON "delivery_challan_receipt_lines" ("receipt_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "delivery_challan_receipt_lines_dc_line_idx"
  ON "delivery_challan_receipt_lines" ("delivery_challan_line_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "delivery_challan_receipt_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "delivery_challan_receipt_lines_company_read" ON "delivery_challan_receipt_lines"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "delivery_challan_receipt_lines_manager_write" ON "delivery_challan_receipt_lines"
    FOR ALL TO authenticated
    USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
    WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ─── v_jc_op_status view patch ────────────────────────────────
-- Replace v_jc_status first (it depends on v_jc_op_status); CREATE OR REPLACE
-- on a view fails if a depending object would break. v_jc_status keeps its
-- same column set so CREATE OR REPLACE is safe.
DROP VIEW IF EXISTS public.v_jc_status;
--> statement-breakpoint

DROP VIEW IF EXISTS public.v_jc_op_status;
--> statement-breakpoint

CREATE VIEW public.v_jc_op_status AS
WITH op_log_rollup AS (
  SELECT
    jc_op_id,
    SUM(CASE WHEN log_type = 'complete' THEN qty ELSE 0 END) AS completed_qty,
    SUM(CASE WHEN log_type = 'qc' THEN qty ELSE 0 END) AS qc_accepted_qty,
    SUM(CASE WHEN log_type = 'qc' THEN reject_qty ELSE 0 END) AS qc_rejected_qty
  FROM public.op_log
  GROUP BY jc_op_id
),
running_check AS (
  SELECT DISTINCT jc_op_id
  FROM public.running_ops
  WHERE status = 'running'
),
outsource_receipts_rollup AS (
  -- Sum of received + rejected per outsource jc_op via:
  --   jc_op → po_line → dc_line (via po_line) → receipt_line
  -- Cancelled / deleted DCs and deleted receipts are excluded.
  SELECT
    o.id AS jc_op_id,
    COALESCE(SUM(drl.received_qty), 0)::numeric AS outsource_received_qty,
    COALESCE(SUM(drl.rejected_qty), 0)::numeric AS outsource_rejected_qty
  FROM public.jc_ops o
  LEFT JOIN public.delivery_challan_lines dcl
    ON dcl.purchase_order_line_id = o.outsource_po_line_id
    AND dcl.deleted_at IS NULL
  LEFT JOIN public.delivery_challans dc
    ON dc.id = dcl.delivery_challan_id
    AND dc.deleted_at IS NULL
    AND dc.status <> 'cancelled'
  LEFT JOIN public.delivery_challan_receipt_lines drl
    ON drl.delivery_challan_line_id = dcl.id
    AND drl.deleted_at IS NULL
  WHERE o.op_type = 'outsource'
    AND o.deleted_at IS NULL
  GROUP BY o.id
),
prev_op_output AS (
  SELECT
    o.id AS jc_op_id,
    o.job_card_id,
    o.op_seq,
    jc.order_qty AS jc_order_qty,
    LAG(
      CASE
        WHEN o.qc_required OR o.op_type = 'qc'
          THEN COALESCE(r.qc_accepted_qty, 0)
        WHEN o.op_type = 'outsource'
          THEN GREATEST(
            0,
            COALESCE(orr.outsource_received_qty, 0) - COALESCE(orr.outsource_rejected_qty, 0)
          )
        ELSE COALESCE(r.completed_qty, 0)
      END,
      1
    ) OVER (PARTITION BY o.job_card_id ORDER BY o.op_seq) AS prev_output
  FROM public.jc_ops o
  LEFT JOIN op_log_rollup r ON r.jc_op_id = o.id
  LEFT JOIN outsource_receipts_rollup orr ON orr.jc_op_id = o.id
  LEFT JOIN public.job_cards jc ON jc.id = o.job_card_id
  WHERE o.deleted_at IS NULL AND jc.deleted_at IS NULL
)
SELECT
  o.id AS jc_op_id,
  o.company_id,
  o.job_card_id,
  o.op_seq,
  o.op_type,
  o.qc_required,
  o.outsource_status,
  COALESCE(r.completed_qty, 0)::integer AS completed_qty,
  COALESCE(r.qc_accepted_qty, 0)::integer AS qc_accepted_qty,
  COALESCE(r.qc_rejected_qty, 0)::integer AS qc_rejected_qty,
  CASE
    WHEN o.op_seq = 1 THEN p.jc_order_qty
    ELSE COALESCE(p.prev_output, 0)
  END::integer AS input_avail,
  GREATEST(
    0,
    (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END)
      - COALESCE(r.completed_qty, 0)
  ) + COALESCE(o.rework_qty, 0) AS available,
  CASE
    WHEN (o.qc_required OR o.op_type = 'qc') THEN
      GREATEST(
        0,
        (CASE
          WHEN o.op_type = 'qc' THEN (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END)
          ELSE COALESCE(r.completed_qty, 0)
        END) - COALESCE(r.qc_accepted_qty, 0) - COALESCE(r.qc_rejected_qty, 0)
      )
    ELSE 0
  END AS qc_pending,
  CASE
    -- Complete: output >= order_qty AND (no qc OR qc fully resolved)
    WHEN p.jc_order_qty > 0
      AND (CASE WHEN o.op_type = 'qc' THEN (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) ELSE COALESCE(r.completed_qty, 0) END) >= p.jc_order_qty
      AND (
        NOT (o.qc_required OR o.op_type = 'qc')
        OR COALESCE(r.qc_accepted_qty, 0) + COALESCE(r.qc_rejected_qty, 0)
           >= (CASE WHEN o.op_type = 'qc' THEN (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) ELSE COALESCE(r.completed_qty, 0) END)
      )
      THEN 'complete'
    -- Outsource fully received — short-circuits the sub-state CASE below
    -- so the JC-level done_ops count includes received outsource ops and
    -- the sales cascade fires when the outsource is the last step.
    WHEN o.op_type = 'outsource' AND o.outsource_status = 'received' THEN 'complete'
    -- QC Pending: qc required and unresolved
    WHEN (o.qc_required OR o.op_type = 'qc')
      AND GREATEST(
        0,
        (CASE WHEN o.op_type = 'qc' THEN (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) ELSE COALESCE(r.completed_qty, 0) END) - COALESCE(r.qc_accepted_qty, 0) - COALESCE(r.qc_rejected_qty, 0)
      ) > 0
      THEN 'qc_pending'
    -- Running: an active running_ops session exists
    WHEN rc.jc_op_id IS NOT NULL THEN 'running'
    -- In Progress: some completion logged, not yet running, not yet complete
    WHEN COALESCE(r.completed_qty, 0) > 0 THEN 'in_progress'
    -- Outsource sub-states (mirrors legacy line 1687-1696)
    WHEN o.op_type = 'outsource' THEN
      CASE COALESCE(o.outsource_status::text, 'pending')
        WHEN 'pr_raised'  THEN 'pr_raised'
        WHEN 'po_created' THEN 'po_created'
        WHEN 'sent'       THEN 'at_vendor'
        WHEN 'received'   THEN 'received'
        ELSE
          CASE
            WHEN (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) > 0
              THEN 'ready_for_pr'
            ELSE 'outsource'
          END
      END
    -- Available: input exists, not yet started
    WHEN (CASE WHEN o.op_seq = 1 THEN p.jc_order_qty ELSE COALESCE(p.prev_output, 0) END) > 0
      THEN 'available'
    -- Default: waiting on prior op
    ELSE 'waiting'
  END AS computed_status
FROM public.jc_ops o
LEFT JOIN op_log_rollup r ON r.jc_op_id = o.id
LEFT JOIN running_check rc ON rc.jc_op_id = o.id
LEFT JOIN prev_op_output p ON p.jc_op_id = o.id
WHERE o.deleted_at IS NULL;
--> statement-breakpoint

-- ─── v_jc_status (recreate exactly as before — depended on v_jc_op_status) ─
CREATE VIEW public.v_jc_status AS
SELECT
  jc.id AS job_card_id,
  jc.company_id,
  COUNT(o.jc_op_id)::integer AS total_ops,
  COUNT(o.jc_op_id) FILTER (WHERE o.computed_status = 'complete')::integer AS done_ops,
  COUNT(o.jc_op_id) FILTER (WHERE o.computed_status = 'qc_pending')::integer AS qc_pending_ops,
  CASE
    WHEN jc.closed_at IS NOT NULL THEN 'closed'
    WHEN COUNT(o.jc_op_id) = 0 THEN 'no_ops'
    WHEN COUNT(o.jc_op_id) FILTER (WHERE o.computed_status = 'complete') = COUNT(o.jc_op_id)
      THEN 'complete'
    WHEN COUNT(o.jc_op_id) FILTER (WHERE o.computed_status = 'qc_pending') > 0
      THEN 'qc_pending'
    ELSE 'open'
  END AS computed_status
FROM public.job_cards jc
LEFT JOIN public.v_jc_op_status o ON o.job_card_id = jc.id
WHERE jc.deleted_at IS NULL
GROUP BY jc.id, jc.company_id, jc.closed_at;
