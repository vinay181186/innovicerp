-- Drop the dead plan_ops.outsource_lead_days column (ADR-080 follow-up).
-- It was never copied into jc_ops (jc_ops has no such column) and no
-- JC/PR/report/cascade read it. All code references were removed in the
-- preceding deploy (665dc27), so the column is safe to drop.
ALTER TABLE public.plan_ops DROP COLUMN IF EXISTS outsource_lead_days;
