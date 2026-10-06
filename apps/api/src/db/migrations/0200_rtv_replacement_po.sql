-- ============================================================
-- 0200_rtv_replacement_po.sql  (ADR-217 — a return to vendor gets a real order)
--
-- A return to vendor is today the ONLY material movement in the system with no
-- purchase order behind it. Two documents compensate by writing the
-- non-conformance number into a column named "PO code":
--     IN-DC-00002/R1  purchase_order_id = NULL, po_code_text = 'NC-00001'
--     IN-GRN-00002    purchase_order_id = NULL, po_code_text = 'NC-00001'
-- while every ordinary job-work challan and receipt carries IN-JWPO-…. Any
-- report that totals by purchase order is therefore blind to every return.
--
-- This migration adds the three links that let a return ride the ordinary rails
-- as a zero-value job-work order. It adds NO behaviour on its own: every column
-- is nullable, nothing existing is rewritten, and an un-upgraded server simply
-- leaves them NULL.
--
--   1. nc_register.replacement_po_id         — the order this return raised.
--   2. nc_register.source_delivery_challan_id— which challan the pieces went
--      out on. There is NO piece, lot or batch tracking in this system
--      (`lot_no` is so_milestones, i.e. SO delivery lots), so for an NC raised
--      at the machine this cannot be derived from any query — it is asked of
--      the person who packed it, and stored here.
--   3. purchase_order_lines.source_nc_id     — "I exist because of this
--      rejection", beside the existing source_pr_id / source_jc_op_id /
--      source_so_line_id.
--
-- What actually makes the auto-create idempotent is the FOR UPDATE lock
-- disposeNcCascade already holds on the NC row, plus setPendingNc's
-- `WHERE status = 'pending'`: the second of two simultaneous dispositions waits,
-- re-reads 'disposed' and is refused before it can raise an order.
--
-- The partial unique index below does NOT catch that case and is not claimed to:
-- it stops TWO deviations naming ONE order, which is a different mistake. A
-- second order for one deviation would overwrite one column on one row, which a
-- unique index accepts.
--
-- ON DELETE SET NULL throughout, matching every other optional link on these
-- tables: a document going to Trash must never cascade a delete into the other.
-- Idempotent (IF NOT EXISTS throughout). Apply to BOTH test and production.
-- Rollback:
--   DROP INDEX IF EXISTS public.nc_register_replacement_po_uq;
--   ALTER TABLE public.nc_register
--     DROP COLUMN IF EXISTS replacement_po_id,
--     DROP COLUMN IF EXISTS source_delivery_challan_id;
--   ALTER TABLE public.purchase_order_lines DROP COLUMN IF EXISTS source_nc_id;
-- ============================================================

ALTER TABLE public.nc_register
  ADD COLUMN IF NOT EXISTS replacement_po_id uuid
    REFERENCES public.purchase_orders (id) ON DELETE SET NULL;

ALTER TABLE public.nc_register
  ADD COLUMN IF NOT EXISTS source_delivery_challan_id uuid
    REFERENCES public.delivery_challans (id) ON DELETE SET NULL;

ALTER TABLE public.purchase_order_lines
  ADD COLUMN IF NOT EXISTS source_nc_id uuid
    REFERENCES public.nc_register (id) ON DELETE SET NULL;

-- One replacement order per non-conformance. Partial, so the many NCs with no
-- replacement order (rework, scrap, use-as-is, and every row predating ADR-217)
-- do not collide on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS nc_register_replacement_po_uq
  ON public.nc_register (replacement_po_id)
  WHERE replacement_po_id IS NOT NULL;

-- Read paths. Both support questions the screens will ask once phase 3 lands;
-- neither is on a hot path today, and the planner may ignore them until the
-- columns are populated.
CREATE INDEX IF NOT EXISTS purchase_order_lines_source_nc_idx
  ON public.purchase_order_lines (source_nc_id)
  WHERE source_nc_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS nc_register_source_dc_idx
  ON public.nc_register (source_delivery_challan_id)
  WHERE source_delivery_challan_id IS NOT NULL;
