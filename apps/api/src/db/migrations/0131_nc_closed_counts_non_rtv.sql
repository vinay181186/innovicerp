-- ============================================================
-- 0131_nc_closed_counts_non_rtv — ADR-167 code-review F1
--
-- DEFECT. 0129 §B changed v_nc_op_breakup.nc_closed_qty from Σ rejected_qty
-- to Σ cleared_qty of closed non-scrap NCs, so a piece that FAILED a
-- return-to-vendor replacement inspection (alive as the follow-on NC via
-- parent_nc_id) is not counted once per NC generation. But cleared_qty is
-- only ever written by the RTV recovery path (nc-register/recovery.ts
-- creditRecovery). The use_as_is close (cascades.ts), the make_fresh close
-- (cascades.ts) and the legacy in-route rework_done → closed (recovery.ts
-- closeNc / markNcClosed) all leave cleared_qty = 0. Result: an op that
-- rejected 3 and disposed "use as is" reads closed = 0, and with open = 0 and
-- scrap = 0 the JC op card hides the NC strip entirely — the rejects vanish.
--
-- FIX. nc_closed_qty counts, per closed non-scrap NC, keyed on whether a
-- recovery ledger was written (cleared_qty + failed_qty > 0), NOT on the
-- disposition (ADR-167 review R4 — rework/repair child-JC recoveries also
-- write the ledger via recovery.ts climbRecoveryToAncestors → creditRecovery,
-- so keying on disposition = 'return_to_vendor' would have re-counted the
-- failed piece of a rework child):
--   ledger present  (cleared_qty + failed_qty > 0: RTV, rework/repair child)
--                   → cleared_qty   (0129 rule — the failed piece lives on as
--                                    the follow-on NC and is counted there)
--   no ledger       (use_as_is, make_fresh, legacy in-route rework_done)
--                   → rejected_qty  (as before 0129)
--
-- Walk-through, closed column only:
--   RTV chain (3 rejects): NC-A closed cleared 2 / failed 1, NC-B (the failed
--     piece) closed cleared 1  → 2 + 1 = 3.   Same as 0129; still not 4.
--   rework child (3 rejects): NC closed cleared 2 / failed 1 (one piece
--     scrapped on the grandchild) → 2.   Same as 0129; keying on disposition
--     would have read 3.
--   use_as_is (3 rejects): NC closed, cleared_qty 0, failed_qty 0,
--     rejected_qty 3 → 3.   Before 0131 this read 0.
--   make_fresh / in-route rework_done → closed behave like use_as_is.
--   scrap unchanged: scrap_qty = Σ rejected_qty of closed scrap NCs; a scrap
--     close is excluded from nc_closed_qty exactly as before.
--
-- Body is the 0129 §B view verbatim (13 columns, same order and types); the
-- ONLY edit is the nc_closed_qty expression.
--
-- ROLLBACK: re-run the 0129 §B body (CREATE OR REPLACE VIEW public.v_nc_op_breakup).
-- Idempotent. Apply to BOTH the production and the test database.
-- ============================================================

BEGIN;
--> statement-breakpoint

CREATE OR REPLACE VIEW public.v_nc_op_breakup AS
SELECT
  nc.jc_op_id,
  nc.job_card_id,
  nc.company_id,
  COALESCE(SUM(CASE WHEN nc.status = 'pending' THEN nc.rejected_qty ELSE 0 END), 0)::integer AS nc_raised_qty,
  COALESCE(SUM(CASE
      WHEN nc.status = 'under_rework' THEN nc.rejected_qty - nc.cleared_qty - nc.failed_qty
      WHEN nc.disposition = 'rework' AND nc.status IN ('disposed', 'rework_done')
        THEN GREATEST(0, nc.rejected_qty - COALESCE(nc.rework_done_qty, 0))
      ELSE 0 END), 0)::integer AS under_rework_qty,
  COALESCE(SUM(CASE WHEN nc.status = 'under_repair' THEN nc.rejected_qty - nc.cleared_qty - nc.failed_qty ELSE 0 END), 0)::integer AS under_repair_qty,
  COALESCE(SUM(CASE WHEN nc.status IN ('sent_to_vendor', 'received_qc_pending') THEN nc.rtv_sent_qty - nc.rtv_received_qty ELSE 0 END), 0)::integer AS sent_to_vendor_qty,
  COALESCE(SUM(CASE WHEN nc.status = 'received_qc_pending' THEN nc.rtv_received_qty - nc.cleared_qty - nc.failed_qty ELSE 0 END), 0)::integer AS received_qc_pending_qty,
  COALESCE(SUM(CASE WHEN nc.disposition = 'scrap' AND nc.status = 'closed' THEN nc.rejected_qty ELSE 0 END), 0)::integer AS scrap_qty,
  -- 0131 (ADR-167 F1 + R4): a non-scrap close that wrote a recovery ledger
  -- (cleared_qty + failed_qty > 0 — RTV, rework/repair child) counts
  -- cleared_qty (0129 — the failed piece lives on as the follow-on NC and is
  -- counted there); a close with no ledger (use_as_is / make_fresh / in-route
  -- rework_done never write cleared_qty) counts the whole rejected_qty.
  COALESCE(SUM(CASE WHEN nc.status = 'closed' AND nc.disposition IS DISTINCT FROM 'scrap' THEN CASE WHEN nc.cleared_qty + nc.failed_qty > 0 THEN nc.cleared_qty ELSE nc.rejected_qty END ELSE 0 END), 0)::integer AS nc_closed_qty,
  COALESCE(SUM(CASE WHEN nc.status <> 'closed' THEN nc.rejected_qty - nc.cleared_qty - nc.failed_qty ELSE 0 END), 0)::integer AS nc_open_qty,
  COUNT(*) FILTER (WHERE nc.status <> 'closed')::integer AS open_nc_count,
  -- 0129 (G7), appended: return_to_vendor chosen, challan not yet raised.
  COALESCE(SUM(CASE WHEN nc.disposition = 'return_to_vendor' AND nc.status = 'disposed' THEN nc.rejected_qty - nc.cleared_qty - nc.failed_qty ELSE 0 END), 0)::integer AS rtv_awaiting_challan_qty
FROM public.nc_register nc
WHERE nc.deleted_at IS NULL AND nc.jc_op_id IS NOT NULL
GROUP BY nc.jc_op_id, nc.job_card_id, nc.company_id;
--> statement-breakpoint

COMMIT;
