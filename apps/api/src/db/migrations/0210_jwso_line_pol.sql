-- ADR-236 — POL (the customer's PO line number) on Job Work Sales Order lines.
--
-- The Sales Order line has carried it since 0007 (sales_order_lines.
-- client_po_line_no). A JWSO line had nowhere to keep it, so every document
-- raised from a JWSO line (Plan, PRO, Job Card, JW DC, JW invoice, …) showed
-- POL as "—". Same name and type as the SO column, so one read can take
-- COALESCE(sol.client_po_line_no, jwl.client_po_line_no).
--
-- Nullable on purpose: JWSO lines saved before this migration have no POL
-- (PROD 3 lines, TEST 2 on 2026-10-16) and their counters (returned / invoiced
-- / short close) must keep updating. "Compulsory" is enforced where a person
-- types it — the shared line-input schema (packages/shared/src/lib/pol.ts),
-- used by both the form and the API. A NOT NULL / CHECK can follow once the
-- old lines are filled in.
--
-- ROLLBACK: ALTER TABLE public.job_work_order_lines DROP COLUMN client_po_line_no;

ALTER TABLE public.job_work_order_lines
  ADD COLUMN IF NOT EXISTS client_po_line_no text;
