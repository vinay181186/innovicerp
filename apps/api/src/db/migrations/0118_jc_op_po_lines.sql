-- 0118 — an outsourced operation can sit on SEVERAL purchase order lines.
--
-- Phase 4 of the PR→PO balance work (ADR-152), and the one that makes partial
-- ordering safe for OSP rather than only for material.
--
-- `jc_ops.outsource_po_line_id` is a single column, and it is the join key for
-- the entire outsource chain:
--
--     delivery-challans/cascades.ts          joins on outsource_po_line_id
--     delivery-challans/receipt-cascades.ts  joins on outsource_po_line_id
--     job-cards/service.ts                   joins on outsource_po_line_id
--
-- So once a PR may be covered by more than one PO, an outsourced op can only
-- ever follow ONE of them. The second PO's challan and receipt would never
-- cascade back and the operation would silently never complete — material at the
-- vendor, an op stuck at 'sent', and no error anywhere. That is the failure this
-- table removes.
--
-- Shape: one row per (op, PO line) with the quantity that link carries, so the
-- op's outsourced quantity is the SUM of its links rather than an implied whole.
-- It is the same shape as the ADR-081 outsource-balance dual lane — an op whose
-- quantity is split across lanes and recombined — applied to purchasing instead
-- of to in-house vs OSP.
--
-- `jc_ops.outsource_po_line_id` is deliberately KEPT and still written with the
-- FIRST link, exactly as `machines.machine_type` was kept in 0116: every screen
-- and cascade that reads it keeps working untouched while the callers move over
-- one at a time. It stops being the source of truth, not the column.
--
-- Idempotent — every step is guarded, so a re-run is a no-op.

CREATE TABLE IF NOT EXISTS public.jc_op_po_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  jc_op_id uuid NOT NULL REFERENCES public.jc_ops(id) ON DELETE CASCADE,
  purchase_order_line_id uuid NOT NULL REFERENCES public.purchase_order_lines(id) ON DELETE CASCADE,
  -- How much of this operation this particular PO line covers. The op's total
  -- outsourced quantity is SUM(qty) over its live links.
  qty integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz,
  CONSTRAINT jc_op_po_lines_qty_positive CHECK (qty > 0)
);
--> statement-breakpoint

-- One link per (op, line): raising a second PO for the same op and the same line
-- is a mistake, not a second lane. A second LANE is a different line.
CREATE UNIQUE INDEX IF NOT EXISTS jc_op_po_lines_op_line_uniq
  ON public.jc_op_po_lines (jc_op_id, purchase_order_line_id)
  WHERE deleted_at IS NULL;
--> statement-breakpoint

-- The two directions the cascades travel: challan/receipt arrives holding a PO
-- line and needs its ops; the job card screen holds an op and needs its lines.
CREATE INDEX IF NOT EXISTS jc_op_po_lines_po_line_idx
  ON public.jc_op_po_lines (purchase_order_line_id) WHERE deleted_at IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS jc_op_po_lines_jc_op_idx
  ON public.jc_op_po_lines (jc_op_id) WHERE deleted_at IS NULL;
--> statement-breakpoint

ALTER TABLE public.jc_op_po_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS jc_op_po_lines_company_read ON public.jc_op_po_lines;
--> statement-breakpoint

CREATE POLICY jc_op_po_lines_company_read ON public.jc_op_po_lines
  FOR SELECT TO authenticated
  USING (company_id = current_company_id());
--> statement-breakpoint

DROP POLICY IF EXISTS jc_op_po_lines_manager_write ON public.jc_op_po_lines;
--> statement-breakpoint

CREATE POLICY jc_op_po_lines_manager_write ON public.jc_op_po_lines
  FOR ALL TO authenticated
  USING (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id())
  WITH CHECK (current_user_role() IN ('admin', 'manager') AND company_id = current_company_id());
--> statement-breakpoint

-- Backfill: every op already pointing at a PO line becomes one link carrying
-- that line's quantity. After this the link table is a superset of the old
-- column, so a caller can be moved across without a behaviour change and the
-- two can be compared to prove it.
--
-- created_by/updated_by borrow the company's first admin because a migration has
-- no session user — the same approach 0116 took.
INSERT INTO public.jc_op_po_lines
        (company_id, jc_op_id, purchase_order_line_id, qty, created_by, updated_by)
SELECT o.company_id,
       o.id,
       o.outsource_po_line_id,
       GREATEST(pol.qty, 1),
       (SELECT u.id FROM public.users u
         WHERE u.company_id = o.company_id AND u.role = 'admin' AND u.deleted_at IS NULL
         ORDER BY u.created_at LIMIT 1),
       (SELECT u.id FROM public.users u
         WHERE u.company_id = o.company_id AND u.role = 'admin' AND u.deleted_at IS NULL
         ORDER BY u.created_at LIMIT 1)
  FROM public.jc_ops o
  JOIN public.purchase_order_lines pol ON pol.id = o.outsource_po_line_id
 WHERE o.outsource_po_line_id IS NOT NULL
   AND o.deleted_at IS NULL
   AND pol.deleted_at IS NULL
   AND EXISTS (SELECT 1 FROM public.users u
                WHERE u.company_id = o.company_id AND u.role = 'admin' AND u.deleted_at IS NULL)
   AND NOT EXISTS (SELECT 1 FROM public.jc_op_po_lines l
                    WHERE l.jc_op_id = o.id
                      AND l.purchase_order_line_id = o.outsource_po_line_id
                      AND l.deleted_at IS NULL);
