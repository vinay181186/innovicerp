-- ADR-274 (owner 2026-11-05): every Super Admin reply on a Day Log (a saved entry
-- or a blank date) reaches the person's Task Board Inbox and the sender's Outbox.
--
--   tasks_day_log_reply_open_uq — one OPEN task per entry / date PER SENDER. The
--     writer (tasks/day-log-task.ts) runs under the day header lock; this index is
--     the backstop. It replaces tasks_day_log_date_open_uq (0239, one per day).
--   The data fix — the task's dot now follows the reply (Task Board no longer
--     stamps these tasks viewed), so an open blank-date task whose replies are all
--     seen must not stay New for ever.
--
-- PRIVACY: the reply text stays in the reply tables (0228, 0239) and is read live
-- by the API. Nothing here copies it: tasks has a company-wide read policy.
--
-- Additive; the new index goes on before the old one comes off.

CREATE UNIQUE INDEX IF NOT EXISTS "tasks_day_log_reply_open_uq"
  ON "tasks" ("company_id", "linked_ref_type", "linked_ref_id", "created_by")
  WHERE "linked_ref_type" IN ('day_log_date', 'day_log_entry') AND "deleted_at" IS NULL
    AND "status" IN ('todo', 'in_progress');
--> statement-breakpoint
DROP INDEX IF EXISTS "tasks_day_log_date_open_uq";
--> statement-breakpoint
UPDATE "tasks" t
SET "viewed_at" = now()
WHERE t."linked_ref_type" = 'day_log_date'
  AND t."deleted_at" IS NULL
  AND t."status" IN ('todo', 'in_progress')
  AND t."viewed_at" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "daily_report_day_replies" rp
    WHERE rp."daily_report_id"::text = t."linked_ref_id"
      AND rp."company_id" = t."company_id"
      AND rp."seen_at" IS NULL
      AND rp."deleted_at" IS NULL
  );
