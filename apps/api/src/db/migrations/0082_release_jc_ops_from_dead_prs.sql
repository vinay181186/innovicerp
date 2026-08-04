-- 0082 — One-time cleanup for ADR-101 (release JC ops stamped by a dead PR).
--
-- Bug: cancelling a jw_osp Purchase Request only updated the PR row. The stamp
-- it had written onto the source operation (`jc_ops.outsource_pr_id` +
-- `outsource_status`) was never cleared, and the JC-edit lock guard reads
-- exactly those two columns to decide "this op is committed to procurement".
-- Result: the op was frozen permanently — it could not be removed, retyped
-- (outsource → in-house), or re-sequenced — and the error told the user to
-- "cancel the PR/PO first", which they had already done.
--
-- Code side is fixed in this same change:
--   * purchase-requests/service.ts — cancel/soft-delete now clears the stamp.
--   * job-cards/service.ts — the lock guard joins the PR and ignores a stamp
--     whose PR is cancelled or soft-deleted.
--
-- This migration repairs rows stamped BEFORE that fix. DATA-ONLY (no schema
-- change) and IDEMPOTENT — once cleared, the WHERE no longer matches.
--
-- Safety: only ops with NO purchase-order line and a pre-PO outsource status
-- are touched. An op that reached po_created / sent / received, or that carries
-- an `outsource_po_line_id`, is a real commitment and is left exactly as-is.
--
-- Superuser connection: disable RLS for the data write below.
SET row_security = off;
--> statement-breakpoint

UPDATE public.jc_ops o
SET outsource_pr_id = NULL,
    outsource_status = NULL,
    updated_at = now()
FROM public.purchase_requests pr
WHERE pr.id = o.outsource_pr_id
  AND o.deleted_at IS NULL
  AND o.outsource_po_line_id IS NULL
  AND o.outsource_status IN ('pending', 'pr_raised')
  AND (pr.status = 'cancelled' OR pr.deleted_at IS NOT NULL);
