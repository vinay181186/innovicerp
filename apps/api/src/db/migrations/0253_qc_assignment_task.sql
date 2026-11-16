-- ADR-298: QC Center's Assign Inspector / Pick Up raises a Task Board task.
--
--   qc_assignments.task_id   the task this assignment raised (Related To: QC call).
--                            A reassign moves THAT task, never a task someone
--                            typed by hand for the same call. NULL for rows made
--                            before 0253: their task is raised on the next Assign.
--
-- No backfill. The runner bypasses RLS. Safe to re-run.
--
-- ROLLBACK (only after the code reading it is gone):
--   ALTER TABLE public.qc_assignments DROP COLUMN task_id;

ALTER TABLE public.qc_assignments
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS qc_assignments_task_idx
  ON public.qc_assignments (task_id) WHERE task_id IS NOT NULL;
