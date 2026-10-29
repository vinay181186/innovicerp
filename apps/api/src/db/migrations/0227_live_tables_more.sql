-- ============================================================
-- 0227_live_tables_more
-- Live-update standard (owner 2026-10-29, CLAUDE.md §22). Puts the tables of
-- QC Documents / Dossier, Multi-Level BOM, Multi-Level Planning and Route
-- Cards into the Realtime publication, so a change on one PC refreshes those
-- screens on every other PC (ADR-230). customer_dispatches, delivery_challans
-- and nc_register were already published by 0205 (record watch); they are
-- listed again only so a database that missed 0205 still ends up complete.
--
-- The browser subscribes to a table only once packages/shared LIVE_TABLES
-- lists it. Realtime sends a changed row to a subscriber only when that
-- user's RLS SELECT policy allows it — every table here is readable by the
-- whole company (`company_id = current_company_id()`), the same rule as the
-- job cards and orders that are already live.
--
-- NOT added: `tasks`. Realtime ignores publication column lists (tested on
-- TEST 2026-10-29: `ADD TABLE tasks (id, company_id)` still delivered every
-- column) and would push private to-dos (ADR-254) to every user.
--
-- Same guard as 0217/0222: no-op without the publication, skips a table that
-- is already published. Idempotent; no data change.
-- Apply: DB_TARGET=TEST|PROD … tsx src/db/apply-sql.ts (see apply-sql.ts header).
-- ============================================================

DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'realtime: no supabase_realtime publication on this database — nothing to do';
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY[
    'customer_dispatches', 'delivery_challans', 'nc_register',
    'qc_documents',
    'ml_boms', 'ml_bom_lines',
    'ml_plans', 'ml_plan_nodes',
    'route_cards', 'route_card_ops'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      RAISE NOTICE 'realtime: % already published', t;
    ELSE
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      RAISE NOTICE 'realtime: added %', t;
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- DOWN (rollback reference only — NOT run by apply-sql; copy by hand).
-- Drop only the seven tables this migration newly published; the three 0205
-- tables stay (the record watch needs them).
--
-- ALTER PUBLICATION supabase_realtime DROP TABLE
--   public.qc_documents, public.ml_boms, public.ml_bom_lines,
--   public.ml_plans, public.ml_plan_nodes, public.route_cards, public.route_card_ops;
-- ------------------------------------------------------------
