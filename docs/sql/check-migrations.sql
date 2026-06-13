-- ============================================================================
-- check-migrations.sql  —  GO-LIVE Phase 1, step 3
-- ============================================================================
-- Confirms the recent Drizzle migrations are actually applied to THIS database
-- before launch. The dev DB has historically lagged the migration files (they
-- are applied by hand here), so this verifies the signature object each recent
-- migration creates actually exists.
--
-- HOW TO RUN: Supabase Dashboard → SQL Editor → paste → Run, against the project
-- you are promoting to production. Every row should read PASS. Any MISSING row
-- means that migration was never applied — apply it before onboarding the team.
--
-- Scope: migrations 0050–0056 (the recent, highest-risk-of-lag set). Older
-- migrations are implicitly proven by the app already running on this DB.
-- ============================================================================

WITH expected_tables (migration, name) AS (
  VALUES
    ('0051_tasks',            'tasks'),
    ('0051_tasks',            'task_comments'),
    ('0051_tasks',            'daily_reports'),
    ('0051_tasks',            'daily_report_lines'),
    ('0052_dashboard_config', 'dashboard_config'),
    ('0055_file_registry',    'file_registry'),
    ('0056_so_milestones',    'so_milestones')
),
expected_columns (migration, tbl, col) AS (
  VALUES
    ('0050_finance',  'sales_order_lines',     'dispatched_qty'),
    ('0050_finance',  'invoices',              'subtotal'),
    ('0053_jw_rate',  'job_work_orders',       'client_material'),
    ('0053_jw_rate',  'job_work_order_lines',  'rate'),
    ('0054_company_email', 'companies',        'email')
)
SELECT et.migration,
       'table'  AS kind,
       et.name  AS object,
       CASE WHEN t.table_name IS NULL THEN 'MISSING ❌' ELSE 'PASS ✅' END AS status
  FROM expected_tables et
  LEFT JOIN information_schema.tables t
         ON t.table_schema = 'public' AND t.table_name = et.name
UNION ALL
SELECT ec.migration,
       'column' AS kind,
       ec.tbl || '.' || ec.col AS object,
       CASE WHEN c.column_name IS NULL THEN 'MISSING ❌' ELSE 'PASS ✅' END AS status
  FROM expected_columns ec
  LEFT JOIN information_schema.columns c
         ON c.table_schema = 'public' AND c.table_name = ec.tbl AND c.column_name = ec.col
ORDER BY migration, kind, object;

-- Optional: see what Drizzle's own journal thinks is applied (if present).
-- SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at;
