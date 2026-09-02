-- 0103 — a Purchase Order LINE remembers which Purchase Request it came from.
--
-- Until now the PR link lived only on the header (`purchase_orders.pr_id`), so
-- a PO could only ever be "against one PR". The batch path already had to null
-- that column out whenever a PO spanned several PRs, which made "which PR did
-- this line come from?" unanswerable. The redesigned PO form lets a buyer pick
-- PR-1, add a line, pick PR-2, add another — one PO, several PRs — so the link
-- has to live on the line.
--
-- `ram_remark` is the per-line remark the buyer records alongside it (separate
-- from the existing `line_remarks`, which carries the PR's operation text on
-- converted lines).
--
-- Both nullable: a line typed by hand on the PO form has no PR behind it, and
-- every existing line predates the column. No backfill — inferring a line's PR
-- from the header would invent data on batch POs, which is exactly the case
-- this column exists to fix.
--
-- Idempotent — every step is guarded, so a re-run is a no-op.

alter table public.purchase_order_lines
  add column if not exists source_pr_id uuid references public.purchase_requests(id) on delete set null,
  add column if not exists ram_remark text;

create index if not exists purchase_order_lines_source_pr_idx
  on public.purchase_order_lines (source_pr_id) where deleted_at is null;
