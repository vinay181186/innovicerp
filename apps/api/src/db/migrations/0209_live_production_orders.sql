-- ADR-233 — Production Order screens refresh live on other PCs.
--
-- Adds production_orders and production_order_closes to the Supabase Realtime
-- publication, the same way 0208 did for the ADR-230 tables. The list is
-- LIVE_TABLES in packages/shared/src/lib/live-tables.ts. Without this a Close,
-- Finish Short or Short Close on one PC stays invisible on another until the
-- 60 s safety refresh.
--
-- RLS: both tables have RLS enabled with a company-isolation policy (0133,
-- 0140) and Realtime applies it per subscriber, so this grants no new access.
-- REPLICA IDENTITY stays default (primary key): the browser needs only the id.
--
-- Same guards as 0205/0208: no-op without the publication, skips a missing or
-- already-published table. Re-running is a no-op.
--
-- ROLLBACK (the screens fall back to the 60 s refresh):
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.production_orders,
--     public.production_order_closes;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY['production_orders', 'production_order_closes'];
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
