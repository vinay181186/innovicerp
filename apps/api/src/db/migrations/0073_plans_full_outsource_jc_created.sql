-- 0073 — allow full_outsource plans to reach status 'jc_created'.
--
-- ADR-077 makes a full_outsource plan seed a Job Card (one OSP op) on execute,
-- so its status becomes 'jc_created' (like manufacture/assembly). The existing
-- plans_type_status_check (0024/0060) only permitted 'jc_created' for
-- manufacture/assembly, so execute 500'd on the plan-status update. Relax the
-- constraint to add full_outsource to the jc_created-allowed set. The pr_created
-- branch is unchanged (a text-only full_outsource plan still lands pr_created).
-- Idempotent (DROP IF EXISTS + ADD).

ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_type_status_check;
--> statement-breakpoint
ALTER TABLE public.plans ADD CONSTRAINT plans_type_status_check CHECK (
  (plan_status <> 'jc_created'::plan_status
     OR plan_type = ANY (ARRAY['manufacture'::plan_type, 'assembly'::plan_type, 'full_outsource'::plan_type]))
  AND
  (plan_status <> 'pr_created'::plan_status
     OR plan_type = ANY (ARRAY['direct_purchase'::plan_type, 'full_outsource'::plan_type]))
);
