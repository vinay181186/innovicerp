-- ============================================================
-- 0014_phase7_saved_reports_trigger
-- BEFORE UPDATE trigger for saved_reports (auto-bumps updated_at).
-- Hand-written companion to 0013_phase7_saved_reports.sql.
-- Apply via:
--   pnpm --filter api exec dotenv -e ../../.env.local -- \
--     tsx src/db/apply-sql.ts src/db/migrations/0014_phase7_saved_reports_trigger.sql
-- ============================================================

DROP TRIGGER IF EXISTS saved_reports_set_updated_at ON public.saved_reports;
--> statement-breakpoint

CREATE TRIGGER saved_reports_set_updated_at
  BEFORE UPDATE ON public.saved_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
