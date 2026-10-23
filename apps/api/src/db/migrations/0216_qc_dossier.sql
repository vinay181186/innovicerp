-- ============================================================
-- 0216_qc_dossier.sql  (ADR-252 — QC Dossier: every QC report in one place)
--
-- A QC report belongs to its QC ENTRY (op_log, log_type 'qc'); the Dossier
-- groups them SO / JWSO -> POL (order line) -> report folder -> entry -> files.
--
--   1. qc_documents.so_line_id / jw_line_id / op_log_id / report_type_id —
--      which order line, which QC entry and which report folder a file is.
--      At most one of the two line links (CHECK). Existing rows take their
--      line from their job card (PROD 0 rows, TEST 0 rows at writing).
--      Index qc_documents_jc_op_idx came with 0043; re-stated IF NOT EXISTS.
--   2. qc_processes.report_type_id — the Report Type a QC process produces.
--   3. op_log.report_required — stamped at Submit QC: true when the op's QC
--      process produces a report, false when not; NULL = saved before this
--      migration (shown red in the Dossier, never on the dashboard — D8).
--      Index op_log_qc_report_path_idx: the Dossier opens a Submit QC report
--      by its storage path (ownership check in drawing-files).
--      Index op_log_qc_report_owed_idx: the home "Reports to upload" list
--      (report_required = true, no report path) without a scan of every QC row.
--   4. report_types seeded per company (only names that are absent,
--      case-insensitive): MIR, DIR, MCR, TPI mandatory; Final Inspection, ICS,
--      Incoming QC, COC, Calibration, Other optional. created_by / updated_by
--      = the company's oldest admin (same rule as 0132 / 0116). Then every QC
--      process whose code names a report type (trimmed, case-insensitive) is
--      linked to it, where it has no report type yet.
--   5. qc_documents write policy stays role-based (admin / manager / qc, as
--      0039). The API bypasses RLS (postgres, 0207) and checks the Access
--      Control ticks itself (ADR-232: qcdocs_upload entry, delete = Super
--      Admin); this policy only guards direct browser -> PostgREST writes.
--
-- ROLLBACK:
--   (section 5 leaves the 0039 write policy as it was — nothing to undo)
--   ALTER TABLE public.qc_documents DROP CONSTRAINT IF EXISTS qc_documents_one_line;
--   ALTER TABLE public.qc_documents DROP COLUMN so_line_id, DROP COLUMN jw_line_id,
--     DROP COLUMN op_log_id, DROP COLUMN report_type_id;
--   ALTER TABLE public.qc_processes DROP COLUMN report_type_id;
--   DROP INDEX IF EXISTS public.op_log_qc_report_path_idx;
--   DROP INDEX IF EXISTS public.op_log_qc_report_owed_idx;
--   ALTER TABLE public.op_log DROP COLUMN report_required;
--   (seeded report_types rows can stay; they are ordinary master rows)
-- Idempotent. Apply to BOTH the test and the production database.
-- ============================================================

-- 1. qc_documents links ------------------------------------------------------
ALTER TABLE public.qc_documents
  ADD COLUMN IF NOT EXISTS so_line_id uuid REFERENCES public.sales_order_lines(id) ON DELETE SET NULL;
--> statement-breakpoint

ALTER TABLE public.qc_documents
  ADD COLUMN IF NOT EXISTS jw_line_id uuid REFERENCES public.job_work_order_lines(id) ON DELETE SET NULL;
--> statement-breakpoint

ALTER TABLE public.qc_documents
  ADD COLUMN IF NOT EXISTS op_log_id uuid REFERENCES public.op_log(id) ON DELETE SET NULL;
--> statement-breakpoint

ALTER TABLE public.qc_documents
  ADD COLUMN IF NOT EXISTS report_type_id uuid REFERENCES public.report_types(id) ON DELETE SET NULL;
--> statement-breakpoint

-- Existing rows: the line comes from the job card (SO line first; a JWSO line
-- only when the card has no SO line, so the CHECK below always holds).
UPDATE public.qc_documents qd
   SET so_line_id = jc.source_so_line_id,
       jw_line_id = CASE WHEN jc.source_so_line_id IS NULL THEN jc.source_jw_line_id END
  FROM public.job_cards jc
 WHERE jc.id = qd.job_card_id
   AND qd.so_line_id IS NULL
   AND qd.jw_line_id IS NULL
   AND (jc.source_so_line_id IS NOT NULL OR jc.source_jw_line_id IS NOT NULL);
--> statement-breakpoint

ALTER TABLE public.qc_documents DROP CONSTRAINT IF EXISTS qc_documents_one_line;
--> statement-breakpoint

ALTER TABLE public.qc_documents
  ADD CONSTRAINT qc_documents_one_line CHECK (num_nonnulls(so_line_id, jw_line_id) <= 1);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS qc_documents_company_so_line_idx
  ON public.qc_documents (company_id, so_line_id) WHERE deleted_at IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS qc_documents_company_jw_line_idx
  ON public.qc_documents (company_id, jw_line_id) WHERE deleted_at IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS qc_documents_op_log_idx
  ON public.qc_documents (op_log_id) WHERE deleted_at IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS qc_documents_company_so_idx
  ON public.qc_documents (company_id, sales_order_id) WHERE deleted_at IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS qc_documents_jc_op_idx
  ON public.qc_documents (jc_op_id) WHERE deleted_at IS NULL;
--> statement-breakpoint

-- 2. qc_processes -> report type --------------------------------------------
ALTER TABLE public.qc_processes
  ADD COLUMN IF NOT EXISTS report_type_id uuid REFERENCES public.report_types(id) ON DELETE SET NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS qc_processes_report_type_idx
  ON public.qc_processes (report_type_id) WHERE deleted_at IS NULL;
--> statement-breakpoint

-- 3. op_log.report_required ---------------------------------------------------
ALTER TABLE public.op_log ADD COLUMN IF NOT EXISTS report_required boolean;
--> statement-breakpoint

-- The QC Dossier opens a Submit QC report by its path (drawing-files
-- ownership check), so the path is looked up.
CREATE INDEX IF NOT EXISTS op_log_qc_report_path_idx
  ON public.op_log (company_id, qc_report_path) WHERE qc_report_path IS NOT NULL;
--> statement-breakpoint

-- Home list "Reports to upload" (dashboard rows-qc.ts qcReportMissingSql)
-- reads only QC entries that owe a report and have no path. The predicate is
-- written EXACTLY as that query's WHERE clauses so the planner can match it
-- (a blank path counts as no path, as everywhere else).
CREATE INDEX IF NOT EXISTS op_log_qc_report_owed_idx
  ON public.op_log (company_id)
  WHERE log_type = 'qc' AND report_required = true
    AND NULLIF(btrim(COALESCE(qc_report_path, '')), '') IS NULL;
--> statement-breakpoint

-- 4. Seed report types (absent names only) ----------------------------------
INSERT INTO public.report_types
  (company_id, name, description, default_mandatory, status, created_by, updated_by)
SELECT c.id, s.name, s.description, s.mandatory, 'Active',
       (SELECT u.id FROM public.users u
         WHERE u.company_id = c.id AND u.role = 'admin' AND u.deleted_at IS NULL
         ORDER BY u.created_at LIMIT 1),
       (SELECT u.id FROM public.users u
         WHERE u.company_id = c.id AND u.role = 'admin' AND u.deleted_at IS NULL
         ORDER BY u.created_at LIMIT 1)
  FROM public.companies c
 CROSS JOIN (VALUES
   ('MIR', 'Material Inspection Report', true),
   ('DIR', 'Dimensional Inspection Report', true),
   ('MCR', 'Material Compliance Report', true),
   ('TPI', 'Third Party Inspection', true),
   ('Final Inspection', 'Final Inspection report', false),
   ('ICS', 'ICS', false),
   ('Incoming QC', 'Incoming QC report', false),
   ('COC', 'Certificate of Conformance', false),
   ('Calibration', 'Calibration certificate', false),
   ('Other', 'Other QC document', false)
 ) AS s(name, description, mandatory)
 WHERE c.deleted_at IS NULL
   AND EXISTS (SELECT 1 FROM public.users u
                WHERE u.company_id = c.id AND u.role = 'admin' AND u.deleted_at IS NULL)
   AND NOT EXISTS (SELECT 1 FROM public.report_types r
                    WHERE r.company_id = c.id AND r.deleted_at IS NULL
                      AND lower(btrim(r.name)) = lower(s.name));
--> statement-breakpoint

-- Link each QC process to the report type its code names (blank links only).
UPDATE public.qc_processes qp
   SET report_type_id = (
         SELECT r.id FROM public.report_types r
          WHERE r.company_id = qp.company_id AND r.deleted_at IS NULL
            AND lower(btrim(r.name)) = lower(btrim(qp.code))
          ORDER BY r.created_at LIMIT 1),
       updated_at = now()
 WHERE qp.report_type_id IS NULL
   AND qp.deleted_at IS NULL
   AND EXISTS (SELECT 1 FROM public.report_types r
                WHERE r.company_id = qp.company_id AND r.deleted_at IS NULL
                  AND lower(btrim(r.name)) = lower(btrim(qp.code)));
--> statement-breakpoint

-- 5. qc_documents write policy: KEEP the role-based one ----------------------
-- An earlier draft of this migration widened it to company-only. Not done:
-- the API connects as postgres (BYPASSRLS, see 0207), so this policy never
-- touches an API upload — the Access Control ticks there decide. The policy
-- only governs a DIRECT browser -> PostgREST write, which since 0207 carries
-- company_id + app_role in the token and is therefore reachable. There is no
-- SQL function that reads the Access Control ticks, so the role check
-- (admin / manager / qc, as 0039) stays as the guard on that path. Restated
-- here so a database that ran the earlier draft is put back.
DROP POLICY IF EXISTS qc_documents_company_write ON public.qc_documents;
--> statement-breakpoint

DROP POLICY IF EXISTS qc_documents_qc_write ON public.qc_documents;
--> statement-breakpoint

CREATE POLICY qc_documents_qc_write ON public.qc_documents
  AS PERMISSIVE FOR ALL TO authenticated
  USING (current_user_role() IN ('admin', 'manager', 'qc') AND company_id = current_company_id())
  WITH CHECK (current_user_role() IN ('admin', 'manager', 'qc') AND company_id = current_company_id());
