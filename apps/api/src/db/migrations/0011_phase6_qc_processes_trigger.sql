-- Phase 6 (T-038) — qc_processes BEFORE UPDATE trigger.
-- Hand-written companion to 0010_phase6_qc_processes.sql; same pattern as
-- the Phase 2/3/4/5 master/transactional triggers. Idempotent so re-runs
-- via apply-sql.ts are safe.

DROP TRIGGER IF EXISTS qc_processes_set_updated_at ON public.qc_processes;
--> statement-breakpoint
CREATE TRIGGER qc_processes_set_updated_at
  BEFORE UPDATE ON public.qc_processes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
