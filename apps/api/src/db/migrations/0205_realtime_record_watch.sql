-- ADR-226 / ADR-004 (amended) — switch live updates ON for the documents whose
-- edit screens warn you the moment someone else saves.
--
-- WHY THIS EXISTS AT ALL: the `supabase_realtime` publication was EMPTY. Not
-- one table was registered with it — including `op_log` and `running_ops`,
-- which modules/op-entry subscribes to. Those subscriptions have therefore
-- never delivered a single event; what has actually been keeping Op Entry
-- current is the 30-second poll sitting beside them, which the code itself
-- labels "30s polling fallback alongside Realtime".
--
-- OP ENTRY IS DELIBERATELY NOT FIXED HERE, and that is a reversal. An earlier
-- draft of this migration published `op_log` and `running_ops` too, to repair a
-- feature that has never worked. It was taken back out, because
-- `useRealtimeRunningOps` (modules/op-entry/api.ts) subscribes with NO row
-- filter — `{ event: '*', table: 'running_ops' }` — and invalidates two query
-- prefixes on every event. Publishing that table means every start, stop and
-- pause by any operator makes every open Op Entry page refetch the running list
-- and the JC-ops list, and the page plus its "By Machine" view each hold a
-- subscription. That is a brand-new load pattern on the busiest screen in the
-- factory, introduced by a release about edit conflicts, on a screen this
-- release does not otherwise touch — and it is the one effect that a code
-- revert would NOT undo, because publication membership outlives the code.
--
-- Op Entry works today on its poll. Switching it to live updates is a real
-- improvement and a one-line follow-up (add the two tables here), but it
-- deserves its own change and its own watching.
--
-- ADR-004 AMENDMENT: the original rule allowed Realtime only on Op Entry, Live
-- Operations Board, Machine Status and Task Allocation, on the arithmetic
-- "100 users x 5 tabs = 500 connections x ~50 KB". That arithmetic was written
-- about putting Realtime on EVERY screen. Here a subscription exists only while
-- one of these documents' EDIT forms is open, filtered to a single row by id —
-- in a factory with ~23 logins that is a handful of connections at a time, not
-- 500. The amendment is recorded in docs/DECISIONS.md, not just here.
--
-- A publication is a per-table opt-in list, and ADD TABLE is idempotent-unsafe
-- (it errors if the table is already a member), so each statement is guarded by
-- a catalogue check. Re-running this migration is a no-op.
--
-- RLS: every table below already has RLS enabled with a company-isolation
-- policy, and Realtime applies RLS at the WebSocket layer, so a subscriber only
-- ever receives rows their own login may read. Nothing here grants new access —
-- it only lets a change the user could already have polled for arrive sooner.
--
-- SELECT on the publication's tables is what Realtime replicates; we add no
-- columns and no triggers, so there is no write-path cost. REPLICA IDENTITY
-- stays at its default (primary key), which is all a row-filtered subscription
-- on `id` needs — we never need the OLD row's other columns.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    -- The 13 documents whose edit screens get the live warning (ADR-226).
    'goods_receipt_notes',
    'job_cards',
    'delivery_challans',
    'customer_dispatches',
    'nc_register',
    'users',
    'user_access',
    'machines',
    'operators',
    'qc_processes',
    'tpi_masters',
    'cost_centers',
    'saved_reports'
    -- `op_log` and `running_ops` deliberately NOT here — see the header.
  ];
BEGIN
  -- ADR-226 review — guard the PUBLICATION, not just each table. The per-table
  -- pg_class check below was written so "a migration must not be the thing that
  -- breaks a restore of an older snapshot", but `ALTER PUBLICATION
  -- supabase_realtime …` fails outright with `publication does not exist` on any
  -- database that has no Supabase realtime set up — a plain Postgres restore, a
  -- local dev database, a non-Supabase target. The stated goal was not met.
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'realtime: no supabase_realtime publication on this database — nothing to do';
    RETURN;
  END IF;

  FOREACH t IN ARRAY tables LOOP
    -- Skip a table that does not exist on this database rather than failing the
    -- whole migration; every name above is in schema.ts today, but a migration
    -- must not be the thing that breaks a restore of an older snapshot.
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
