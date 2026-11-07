-- All Tasks "Assigned Date": when a task reached its current assignee.
--
--   assigned_at  set at creation (column default), moved only by Reassign
--
-- Backfill, every row including soft-deleted: the last 'reassigned' entry in
-- task_history, else the task's created_at.
--
-- updated_at does not move: no migration creates a trigger on tasks and TEST has none.
-- The runner bypasses RLS.
-- Safe to re-run: the backfill recomputes the same value from the same history.
--
-- ROLLBACK (only after the code reading it is gone):
--   ALTER TABLE public.tasks DROP COLUMN assigned_at;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
UPDATE public.tasks t
   SET assigned_at = COALESCE(
         (SELECT max(h.created_at)
            FROM public.task_history h
           WHERE h.task_id = t.id
             AND h.action = 'reassigned'),
         t.created_at);
