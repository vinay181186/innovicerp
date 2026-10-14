-- ADR-230 v1 — publish the tables whose changes reach other PCs live.
--
-- The list is LIVE_TABLES in packages/shared/src/lib/live-tables.ts; the web's
-- realtime transport subscribes to exactly those names. job_cards and
-- goods_receipt_notes are already published (0205) and are skipped here.
--
-- Why these: a QC clear (op-entry `submitQcLog`) updates jc_ops and inserts
-- op_log, and neither was published — so "QC cleared on one PC, still showing
-- on the other" had no way to arrive. The rest are the screens owners watch:
-- SO, PO, PR (+ lines) and the edit-approval queue.
--
-- Load: the browser subscribes ONE channel per tab, filtered by company_id,
-- and the core batches events (750 ms, 2 s ceiling) before refreshing — a
-- 40-line save refreshes each screen once. `running_ops` stays unpublished on
-- purpose (0205's reasoning: every machine start/stop would refetch every Op
-- Entry page); its 30 s poll stays.
--
-- RLS: every table below has RLS enabled with a company-isolation policy, and
-- Realtime applies it per subscriber, so this grants no new access — it only
-- lets a change the user could already have polled for arrive sooner.
--
-- REPLICA IDENTITY stays default (primary key): the transport needs only the
-- row id, and a DELETE's old row carries it.
--
-- Same guards as 0205: does nothing on a database without the Supabase
-- publication, skips a table that does not exist, skips one already published.
-- Re-running is a no-op.
--
-- ROLLBACK (only if live load ever needs to be shed; the code keeps working on
-- its 60 s refresh without it):
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.jc_ops, public.op_log,
--     public.sales_orders, public.sales_order_lines, public.purchase_orders,
--     public.purchase_order_lines, public.purchase_requests,
--     public.document_edit_requests;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'job_cards',
    'jc_ops',
    'op_log',
    'sales_orders',
    'sales_order_lines',
    'purchase_orders',
    'purchase_order_lines',
    'purchase_requests',
    'goods_receipt_notes',
    'document_edit_requests'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'realtime: no supabase_realtime publication on this database — nothing to do';
    RETURN;
  END IF;

  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r'
    ) THEN
      RAISE NOTICE 'realtime: skipping %, table not present', t;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      RAISE NOTICE 'realtime: % already published', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    RAISE NOTICE 'realtime: added %', t;
  END LOOP;
END $$;
