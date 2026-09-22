-- 0138 — v_nc_op_breakup: a Make Fresh close keeps counting its written-off pieces
--
-- Make Fresh writes the rejected pieces off and raises a supplementary JC for
-- fresh ones. Until now the NC's ledger stayed 0 cleared / 0 failed, so "open"
-- still read the full qty on a CLOSED NC. The code now books failed_qty =
-- rejected_qty on a make_fresh close (nc-register/cascades.ts) so the ledger
-- balances. Without this view change that write would drop the op card's
-- "NC closed" strip from N to 0 for every make_fresh (0131 counts a closed
-- non-scrap NC by cleared_qty once cleared+failed > 0).
--
-- Change vs 0131: ONE expression — nc_closed_qty counts a make_fresh close by
-- rejected_qty (the pieces the strip should keep showing as handled), before
-- the cleared/rejected rule. Column list, order and types unchanged.
-- Rollback: re-run the 0131 body.
--
-- Apply to BOTH databases (test, then prod) BEFORE deploying the code that
-- writes failed_qty on make_fresh.

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
  COALESCE(SUM(CASE WHEN nc.status = 'closed' AND nc.disposition IS DISTINCT FROM 'scrap' THEN CASE WHEN nc.disposition = 'make_fresh' THEN nc.rejected_qty WHEN nc.cleared_qty + nc.failed_qty > 0 THEN nc.cleared_qty ELSE nc.rejected_qty END ELSE 0 END), 0)::integer AS nc_closed_qty,
  COALESCE(SUM(CASE WHEN nc.status <> 'closed' THEN nc.rejected_qty - nc.cleared_qty - nc.failed_qty ELSE 0 END), 0)::integer AS nc_open_qty,
  COUNT(*) FILTER (WHERE nc.status <> 'closed')::integer AS open_nc_count,
  -- 0129 (G7), appended: return_to_vendor chosen, challan not yet raised.
  COALESCE(SUM(CASE WHEN nc.disposition = 'return_to_vendor' AND nc.status = 'disposed' THEN nc.rejected_qty - nc.cleared_qty - nc.failed_qty ELSE 0 END), 0)::integer AS rtv_awaiting_challan_qty
FROM public.nc_register nc
WHERE nc.deleted_at IS NULL AND nc.jc_op_id IS NOT NULL
GROUP BY nc.jc_op_id, nc.job_card_id, nc.company_id;
--> statement-breakpoint
COMMIT;
