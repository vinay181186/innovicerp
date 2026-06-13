-- ============================================================================
-- purge-demo-data.sql  —  GO-LIVE Phase 1, step 2 (Option A: promote current DB)
-- ============================================================================
-- Hides the leftover demo / smoke data from the team trial by SOFT-DELETING it
-- (sets deleted_at = now()). This respects CLAUDE.md rule #8 (no hard deletes)
-- and is fully REVERSIBLE — to undo, set deleted_at back to NULL for the same
-- code scope.
--
-- WHAT THIS PURGES (everything seeded by _seed_demo_dispatch.ts + early smoke):
--   Sales Orders : SO-DEMO-100, SO-SMOKE-001  (+ their lines, milestones,
--                  dispatches, invoices, invoice lines, dispatch lines)
--   Job Cards    : JC-DEMO-001/002/003, JC-SMOKE-001  (+ their ops)
--   Items        : DEMO-FLG-01, DEMO-SHF-01, DEMO-BRK-01
--   Client       : CLI-DEMO  (Demo Engineering Works)
--   Documents    : file_registry rows linked to the above
--
-- WHAT IS LEFT BEHIND (harmless, append-only ledgers with no deleted_at):
--   store_transactions (demo opening stock + dispatch-out moves) and op_log
--   rows. These are orphaned once their item / JC is hidden and never surface
--   in the app's company-scoped, deleted_at-filtered lists. If you later want
--   ZERO residue, run the optional hard-cleanup block at the bottom (commented
--   out) — but only after a backup, since those deletes are irreversible.
--
-- USERS: this script does NOT touch auth/public.users. If you created throwaway
--   test logins, deactivate them in the app: System Settings → User Management
--   → toggle Active off (don't delete — keeps audit trail intact).
--
-- ──────────────── HOW TO RUN ────────────────
-- 1. TAKE A BACKUP FIRST (Supabase → Database → Backups, or pg_dump). Phase 1.1.
-- 2. Supabase Dashboard → SQL Editor → paste this whole file → Run.
-- 3. Review the final "purge summary" result set (rows newly hidden per table).
-- 4. Open the app and confirm SO / JC / Item / Client lists are clean.
-- ============================================================================

BEGIN;

-- 1) Sales Orders (parents) ---------------------------------------------------
UPDATE sales_orders
   SET deleted_at = now()
 WHERE code IN ('SO-DEMO-100', 'SO-SMOKE-001')
   AND deleted_at IS NULL;

-- 2) SO lines / milestones / dispatches / invoices (children, by SO scope) ----
UPDATE sales_order_lines
   SET deleted_at = now()
 WHERE sales_order_id IN (SELECT id FROM sales_orders WHERE code IN ('SO-DEMO-100', 'SO-SMOKE-001'))
   AND deleted_at IS NULL;

UPDATE so_milestones
   SET deleted_at = now()
 WHERE sales_order_id IN (SELECT id FROM sales_orders WHERE code IN ('SO-DEMO-100', 'SO-SMOKE-001'))
   AND deleted_at IS NULL;

UPDATE customer_dispatches
   SET deleted_at = now()
 WHERE sales_order_id IN (SELECT id FROM sales_orders WHERE code IN ('SO-DEMO-100', 'SO-SMOKE-001'))
   AND deleted_at IS NULL;

UPDATE customer_dispatch_lines
   SET deleted_at = now()
 WHERE customer_dispatch_id IN (
         SELECT id FROM customer_dispatches
          WHERE sales_order_id IN (SELECT id FROM sales_orders WHERE code IN ('SO-DEMO-100', 'SO-SMOKE-001'))
       )
   AND deleted_at IS NULL;

UPDATE invoices
   SET deleted_at = now()
 WHERE sales_order_id IN (SELECT id FROM sales_orders WHERE code IN ('SO-DEMO-100', 'SO-SMOKE-001'))
   AND deleted_at IS NULL;

UPDATE invoice_lines
   SET deleted_at = now()
 WHERE invoice_id IN (
         SELECT id FROM invoices
          WHERE sales_order_id IN (SELECT id FROM sales_orders WHERE code IN ('SO-DEMO-100', 'SO-SMOKE-001'))
       )
   AND deleted_at IS NULL;

-- 3) Job Cards + their ops ----------------------------------------------------
UPDATE jc_ops
   SET deleted_at = now()
 WHERE job_card_id IN (
         SELECT id FROM job_cards
          WHERE code IN ('JC-DEMO-001', 'JC-DEMO-002', 'JC-DEMO-003', 'JC-SMOKE-001')
       )
   AND deleted_at IS NULL;

UPDATE job_cards
   SET deleted_at = now()
 WHERE code IN ('JC-DEMO-001', 'JC-DEMO-002', 'JC-DEMO-003', 'JC-SMOKE-001')
   AND deleted_at IS NULL;

-- 4) Items + Client -----------------------------------------------------------
UPDATE items
   SET deleted_at = now()
 WHERE code IN ('DEMO-FLG-01', 'DEMO-SHF-01', 'DEMO-BRK-01')
   AND deleted_at IS NULL;

UPDATE clients
   SET deleted_at = now()
 WHERE code = 'CLI-DEMO'
   AND deleted_at IS NULL;

-- 5) Documents linked to any of the above ------------------------------------
UPDATE file_registry
   SET deleted_at = now()
 WHERE deleted_at IS NULL
   AND (
        sales_order_id IN (SELECT id FROM sales_orders WHERE code IN ('SO-DEMO-100', 'SO-SMOKE-001'))
     OR job_card_id    IN (SELECT id FROM job_cards   WHERE code IN ('JC-DEMO-001','JC-DEMO-002','JC-DEMO-003','JC-SMOKE-001'))
   );

-- 6) Purge summary — rows still ACTIVE under each demo code (should be 0) -----
--    Run after COMMIT; if any count > 0, something was added after this script
--    was written — re-check the scope before announcing the trial.
SELECT 'sales_orders'    AS table_name, count(*) AS still_active
  FROM sales_orders WHERE code IN ('SO-DEMO-100','SO-SMOKE-001') AND deleted_at IS NULL
UNION ALL SELECT 'job_cards', count(*)
  FROM job_cards WHERE code IN ('JC-DEMO-001','JC-DEMO-002','JC-DEMO-003','JC-SMOKE-001') AND deleted_at IS NULL
UNION ALL SELECT 'items', count(*)
  FROM items WHERE code IN ('DEMO-FLG-01','DEMO-SHF-01','DEMO-BRK-01') AND deleted_at IS NULL
UNION ALL SELECT 'clients', count(*)
  FROM clients WHERE code = 'CLI-DEMO' AND deleted_at IS NULL;

COMMIT;

-- ============================================================================
-- OPTIONAL — zero-residue hard cleanup of the append-only ledgers.
-- IRREVERSIBLE. Only run after a backup, and only if you want the demo stock
-- ledger gone entirely. Leaving it commented is safe for the trial.
-- ============================================================================
-- BEGIN;
-- DELETE FROM op_log
--  WHERE jc_op_id IN (
--        SELECT o.id FROM jc_ops o JOIN job_cards j ON j.id = o.job_card_id
--         WHERE j.code IN ('JC-DEMO-001','JC-DEMO-002','JC-DEMO-003','JC-SMOKE-001'));
-- DELETE FROM store_transactions
--  WHERE item_id IN (SELECT id FROM items WHERE code IN ('DEMO-FLG-01','DEMO-SHF-01','DEMO-BRK-01'));
-- COMMIT;
-- ============================================================================
