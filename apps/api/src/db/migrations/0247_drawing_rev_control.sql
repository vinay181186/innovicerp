-- ADR-289 — Drawing Rev control, step 1 (fix today's Drawing Rev mistakes).
-- Additive only: one new column on user_access, one new table, two new columns
-- on document lines, and a backfill of the invoice one. Nothing is dropped or
-- retyped. Safe to re-run (IF NOT EXISTS / guarded policies / the backfill only
-- touches rows still NULL).
--
-- 1. user_access.drawing_print — "Can print drawings", beside drawing_download
--    (0121). FALSE for everybody on day one; admin / L6 pass without it
--    (canPrintDrawings in packages/shared).
--
-- 2. stock_out_parts — every Rev bucket an un-named stock 'out' actually took
--    (lib/stock-ledger.ts postStockMove splits an out with no Rev across the
--    blank bucket and the Rev buckets; until now the line kept only the FIRST
--    ledger row). One row per bucket per source line, for:
--      · store_issue_lines   (Item Issue — Return / Cancel give back to it)
--      · jw_dc_outward_lines (JW DC Outward — Cancel and the JW DC receipt GRN
--                             give back to it)
--    returned_qty is what has come back into that same bucket; written ONLY by
--    lib/stock-out-parts.ts giveBackToParts, under the item lock (§20.1/20.3).
--    A table, not a jsonb column: CLAUDE.md §12 bans JSON arrays in a column,
--    and returned_qty must be updated per part under a row lock.
--    RLS: company_all, exactly as store_issue_lines / store_issue_returns
--    (0157) — the Item Issue path that writes it uses that policy.
--
-- 3. delivery_challan_lines.item_revision_id / invoice_lines.item_revision_id —
--    each document keeps the Rev it was made with (set at create), instead of
--    reading the SO line's Rev live. Reads fall back to the old live read only
--    while the stored value is NULL.
--    Backfill: invoice lines take the Rev their SO line was DISPATCHED at, only
--    where every live dispatch line of that SO line carries one and the same
--    Rev. Otherwise NULL — never guessed from the SO line's current Rev.
--    Challan lines have no dispatch behind them, so they stay NULL.
--
-- ROLLBACK (only before any code reads them):
--   DROP TABLE public.stock_out_parts;
--   ALTER TABLE public.invoice_lines DROP COLUMN item_revision_id;
--   ALTER TABLE public.delivery_challan_lines DROP COLUMN item_revision_id;
--   ALTER TABLE public.user_access DROP COLUMN drawing_print;

ALTER TABLE public.user_access
  ADD COLUMN IF NOT EXISTS drawing_print boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.stock_out_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  store_issue_line_id uuid REFERENCES public.store_issue_lines(id) ON DELETE CASCADE,
  jw_dc_outward_line_id uuid REFERENCES public.jw_dc_outward_lines(id) ON DELETE CASCADE,
  take_order integer NOT NULL,
  store_transaction_id uuid REFERENCES public.store_transactions(id) ON DELETE SET NULL,
  item_id uuid NOT NULL REFERENCES public.items(id),
  item_revision_id uuid REFERENCES public.item_revisions(id),
  qty numeric(14, 3) NOT NULL,
  returned_qty numeric(14, 3) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.users(id),
  CONSTRAINT stock_out_parts_one_source_check
    CHECK ((store_issue_line_id IS NULL) <> (jw_dc_outward_line_id IS NULL)),
  CONSTRAINT stock_out_parts_qty_check CHECK (qty > 0),
  CONSTRAINT stock_out_parts_returned_check CHECK (returned_qty >= 0 AND returned_qty <= qty)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS stock_out_parts_issue_line_idx
  ON public.stock_out_parts (store_issue_line_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS stock_out_parts_jw_line_idx
  ON public.stock_out_parts (jw_dc_outward_line_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS stock_out_parts_item_revision_idx
  ON public.stock_out_parts (item_revision_id);
--> statement-breakpoint
ALTER TABLE public.stock_out_parts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY stock_out_parts_company_all ON public.stock_out_parts
    FOR ALL TO authenticated
    USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
ALTER TABLE public.delivery_challan_lines
  ADD COLUMN IF NOT EXISTS item_revision_id uuid REFERENCES public.item_revisions(id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS delivery_challan_lines_item_revision_idx
  ON public.delivery_challan_lines (item_revision_id);
--> statement-breakpoint
ALTER TABLE public.invoice_lines
  ADD COLUMN IF NOT EXISTS item_revision_id uuid REFERENCES public.item_revisions(id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS invoice_lines_item_revision_idx
  ON public.invoice_lines (item_revision_id);
--> statement-breakpoint
UPDATE public.invoice_lines il
   SET item_revision_id = d.rev_id
  FROM (
    SELECT cdl.sales_order_line_id, MIN(cdl.item_revision_id::text)::uuid AS rev_id
      FROM public.customer_dispatch_lines cdl
      JOIN public.customer_dispatches cd
        ON cd.id = cdl.customer_dispatch_id AND cd.deleted_at IS NULL
     WHERE cdl.deleted_at IS NULL AND cdl.sales_order_line_id IS NOT NULL
     GROUP BY cdl.sales_order_line_id
    HAVING COUNT(*) FILTER (WHERE cdl.item_revision_id IS NULL) = 0
       AND COUNT(DISTINCT cdl.item_revision_id) = 1
  ) d
 WHERE il.item_revision_id IS NULL
   AND il.sales_order_line_id = d.sales_order_line_id;
