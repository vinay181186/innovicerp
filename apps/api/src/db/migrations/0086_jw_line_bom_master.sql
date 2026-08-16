-- 0086 — a JOB WORK order line can name the BOM it assembles.
--
-- Job work is not only "machine the customer's part". The customer also ships
-- a set of components and asks for a finished assembly back. Until now only
-- sales_order_lines could carry source_bom_master_id, so an assembly JWSO had
-- no way to say what it was building — the whole BOM chain (child job cards,
-- weakest-component readiness, component stock on return) was sales-only.
--
-- What differs from the sales side, and why:
--
--   manufacture  VALID — spawns a child Job Card (source_jw_line_id).
--   outsource    VALID — spawns a child Job Card carrying an outsource op.
--                Deliberately NOT a bare purchase_request: purchase_requests
--                has no job-work link column, job_cards does, and seeding a
--                JC + OSP op is exactly what the full_outsource plan path
--                already does (ADR-095). Readiness then works unchanged —
--                an outsource final op is already scored from its GRN.
--   purchase     BLOCKED — the client owns the job and supplies the material,
--                which is the same rule that already refuses Direct Purchase
--                on a job-work plan. Enforced in the service with a friendly
--                error naming the offending parts; there is no DB constraint
--                because the BOM itself is legitimate, it is only invalid in
--                a job-work CONTEXT (the same BOM may be used by an SO).
--
-- Nullable: every existing JW line has no BOM and must stay valid. A JW line
-- without a BOM keeps its current behaviour exactly (its own job cards drive
-- readiness), so this is additive.
--
-- Each statement stands alone (apply-sql.ts runs them individually) and is
-- re-runnable.

ALTER TABLE public.job_work_order_lines
  ADD COLUMN IF NOT EXISTS source_bom_master_id uuid;
--> statement-breakpoint

-- Added separately from the column so the ALTER stays re-runnable: adding a
-- FK with IF NOT EXISTS is not supported, so guard on the catalog.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'job_work_order_lines_source_bom_master_id_fk'
  ) THEN
    ALTER TABLE public.job_work_order_lines
      ADD CONSTRAINT job_work_order_lines_source_bom_master_id_fk
      FOREIGN KEY (source_bom_master_id)
      REFERENCES public.bom_masters (id);
  END IF;
END $$;
--> statement-breakpoint

-- Postgres does not auto-index foreign keys. Read on every JW line load and by
-- the BOM "where used" lookup. Partial — the vast majority of JW lines carry
-- no BOM at all.
CREATE INDEX IF NOT EXISTS job_work_order_lines_source_bom_idx
  ON public.job_work_order_lines (source_bom_master_id)
  WHERE source_bom_master_id IS NOT NULL;
--> statement-breakpoint

COMMENT ON COLUMN public.job_work_order_lines.source_bom_master_id IS
  'BOM this job-work line assembles. NULL = an ordinary machining line. A BOM containing any purchase-type component is rejected here — job work uses customer-supplied material.';
