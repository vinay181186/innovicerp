-- ============================================================
-- 0008_phase4_jc_alters
-- T-029b — Fulfils ADR-011 #5 (deferred FK contract) per ADR-012 #2-#4.
--   1. Rename source_jw_id → source_jw_line_id (ADR-012 #2 — symmetry with
--      source_so_line_id; safe because column is null in all current rows).
--   2. Add FK source_so_line_id → sales_order_lines(id).
--   3. Add FK source_jw_line_id → job_work_order_lines(id).
--   4. Add CHECK num_nonnulls(source_so_line_id, source_jw_line_id) <= 1
--      (ADR-012 #4 — relaxed from = 1 to allow source-less JCs going forward).
-- ============================================================

ALTER TABLE public.job_cards RENAME COLUMN source_jw_id TO source_jw_line_id;
--> statement-breakpoint

ALTER TABLE public.job_cards
  ADD CONSTRAINT job_cards_source_so_line_id_fk
  FOREIGN KEY (source_so_line_id) REFERENCES public.sales_order_lines(id)
  ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE public.job_cards
  ADD CONSTRAINT job_cards_source_jw_line_id_fk
  FOREIGN KEY (source_jw_line_id) REFERENCES public.job_work_order_lines(id)
  ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE public.job_cards
  ADD CONSTRAINT job_cards_source_check
  CHECK (num_nonnulls(source_so_line_id, source_jw_line_id) <= 1);
