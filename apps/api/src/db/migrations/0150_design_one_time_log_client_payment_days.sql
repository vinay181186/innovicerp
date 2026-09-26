-- ============================================================
-- 0150_design_one_time_log_client_payment_days.sql  (ADR-188)
--
-- ERPNext gap round 2 — owner decisions 2026-09-26.
--
--   (a) ONE engineer time log. Design Tracker's "Log Time" used to write to
--       its own design_time_log; the Design Work Log (design_work_log) held
--       everyone else's hours, so Project Hours never saw tracker time.
--       design_work_log gains design_tracker_id (FK, ON DELETE SET NULL) and
--       the service now writes tracker time there.
--   (b) Data move: every live design_time_log row is copied into
--       design_work_log (engineer_text = the login email of the ONE live
--       same-company user whose email or full name matches worker_text,
--       case-insensitive, else worker_text as typed; category 'Design',
--       design_project_id = the SO's live Design Project when EXACTLY one
--       exists, else NULL; audit columns copied), then soft-deleted in
--       design_time_log. One statement, so the copy and the soft delete
--       land together. The table itself is kept (not dropped).
--       Re-run safe: only live rows with no matching work-log row (same
--       tracker + date + hours + created_at) are moved, and moved rows are
--       soft-deleted, so a second run moves nothing.
--   (c) clients.payment_days — Payment Days, the days a customer is allowed
--       to pay an invoice in; the default for a new invoice's Payment Terms.
--       Nullable (not set), 0..365.
--
-- Idempotent (IF NOT EXISTS / guarded insert).
-- Run again right after the API deploy (idempotent) to move any tracker time the old API wrote in between.
-- Apply to BOTH the test and the production database.
-- Rollback: UPDATE public.design_time_log t SET deleted_at = NULL
--             FROM public.design_work_log w
--            WHERE w.design_tracker_id = t.design_tracker_id AND w.log_date = t.log_date
--              AND w.hours = t.hours AND w.created_at = t.created_at;
--           DELETE FROM public.design_work_log WHERE design_tracker_id IS NOT NULL;
--           ALTER TABLE public.design_work_log DROP COLUMN design_tracker_id;
--           ALTER TABLE public.clients DROP COLUMN payment_days;
--           (the DELETE is a documented admin rollback, run only after a backup)
-- ============================================================

ALTER TABLE public.design_work_log
  ADD COLUMN IF NOT EXISTS design_tracker_id uuid
    REFERENCES public.design_tracker (id) ON DELETE SET NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS design_work_log_tracker_idx
  ON public.design_work_log (design_tracker_id) WHERE deleted_at IS NULL;
--> statement-breakpoint

WITH src AS (
  SELECT tl.id,
         tl.company_id,
         tl.log_date,
         coalesce(
           (SELECT (array_agg(u.email))[1]
              FROM public.users u
             WHERE u.company_id = tl.company_id
               AND u.deleted_at IS NULL
               AND (lower(u.email) = lower(btrim(tl.worker_text))
                    OR lower(u.full_name) = lower(btrim(tl.worker_text)))
            HAVING count(*) = 1),
           tl.worker_text) AS engineer_text,
         tl.hours,
         tl.description,
         tl.design_tracker_id,
         (SELECT (array_agg(dp.id))[1]
            FROM public.design_projects dp
           WHERE dp.company_id = dt.company_id
             AND dp.sales_order_id = dt.sales_order_id
             AND dp.deleted_at IS NULL
          HAVING count(*) = 1) AS design_project_id,
         tl.created_at,
         tl.created_by,
         tl.updated_at,
         tl.updated_by
    FROM public.design_time_log tl
    JOIN public.design_tracker dt ON dt.id = tl.design_tracker_id
   WHERE tl.deleted_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.design_work_log w
        WHERE w.design_tracker_id = tl.design_tracker_id
          AND w.log_date = tl.log_date
          AND w.hours = tl.hours
          AND w.created_at = tl.created_at
     )
),
ins AS (
  INSERT INTO public.design_work_log
    (company_id, log_date, engineer_text, design_project_id, design_tracker_id,
     category, hours, description, created_at, created_by, updated_at, updated_by)
  SELECT company_id, log_date, engineer_text, design_project_id, design_tracker_id,
         'Design', hours, description, created_at, created_by, updated_at, updated_by
    FROM src
  RETURNING id
)
UPDATE public.design_time_log t
   SET deleted_at = now()
  FROM src
 WHERE t.id = src.id;
--> statement-breakpoint

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS payment_days integer
    CONSTRAINT clients_payment_days_range
    CHECK (payment_days IS NULL OR (payment_days >= 0 AND payment_days <= 365));
