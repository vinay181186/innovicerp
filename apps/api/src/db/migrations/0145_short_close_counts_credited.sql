-- ============================================================
-- 0145_short_close_counts_credited  (ADR-184)
--
-- DATA FIX ONLY. No table, column, view or policy changes.
--
-- ADR-184 changes what a Production Order contributes to its plan's Covered
-- (lib/plan-order-coverage.ts ORDER_COVERED_QTY_SQL — the ERPNext rule:
-- plan pending = qty − (order qty − process loss)):
--
--   open / partially_closed  → its full order_qty (still being made)
--   closed / short_closed    → COALESCE(credited_qty, 0) (what it delivered)
--
-- Before ADR-184 a short-closed order was skipped entirely. On TEST,
-- IN-PRO-00019 (plan PLN-0013, order 20) credited 15 and was then short
-- closed: the plan went back to Pending 20 instead of 5, and after a remake
-- order of 5 it read Pending 15 forever. lost_qty stayed NULL, and the Job
-- Card IN-JC-26-00019 and its rework child IN-JC-26-00019-RW1 stayed open.
--
-- The code now does all of this at short-close time. This file brings the
-- rows short closed BEFORE the code landed into the same shape:
--
--   (a) lost_qty for every short-closed order where it is NULL — the NC loss
--       rule of production-orders/service.ts lossSql, read on the order's own
--       Job Card, capped at order_qty − credited. Pieces lost on a rework /
--       repair child are ALREADY on the root card: a child's scrap / make
--       fresh climbs to every ancestor rework NC as failed_qty
--       (nc-register/recovery.ts climbRecoveryToAncestors), which this rule
--       counts. Summing the children's own NCs as well would count the same
--       piece twice, so they are deliberately not added.
--   (b) closed_at = short_closed_at on the order's Job Card and every rework /
--       repair descendant (parent_job_card_id, depth <= 10) still open.
--   (c) route-card plans still 'planned' whose NEW Covered >= plan_qty and
--       that have at least one live order → 'jc_created' (fully covered; the
--       remake order already made up the difference).
--   NOT done here (review, ADR-184): re-opening historic 'jc_created' plans
--   whose old closed orders had losses. Those orders were settled with the
--   customer long ago; re-opening them would fill the planning list with work
--   that no longer exists. Only closes made AFTER this change re-open a plan
--   (production-orders/service.ts shiftPlanPending).
--
-- Idempotent: (a) only touches lost_qty IS NULL, (b) only closed_at IS NULL,
-- (c) only rows whose status disagrees with their Covered. A re-run
-- changes nothing.
-- Apply to BOTH the test and the production database.
-- ============================================================

-- (a) lost_qty on short-closed orders that never got one.
UPDATE public.production_orders po
   SET lost_qty = LEAST(
         GREATEST(COALESCE((
           SELECT ROUND(SUM(CASE
             WHEN nc.status = 'closed' AND nc.disposition IN ('scrap', 'make_fresh') THEN nc.rejected_qty
             WHEN nc.disposition IN ('rework', 'repair') THEN nc.failed_qty
             ELSE 0 END))
           FROM public.nc_register nc
           WHERE nc.deleted_at IS NULL
             AND nc.jc_op_id IS NOT NULL
             AND nc.job_card_id = po.job_card_id
         ), 0), 0),
         GREATEST(po.order_qty - COALESCE(po.credited_qty, 0), 0)
       )::int,
       updated_at = now()
 WHERE po.status = 'short_closed'
   AND po.deleted_at IS NULL
   AND po.lost_qty IS NULL;
--> statement-breakpoint

-- (b) close every Job Card of a short-closed order, and its descendants.
WITH RECURSIVE jc_tree AS (
  SELECT jc.id, po.short_closed_at AS stop_at, 0 AS depth
  FROM public.production_orders po
  JOIN public.job_cards jc
    ON (jc.production_order_id = po.id OR jc.id = po.job_card_id)
   AND jc.company_id = po.company_id
  WHERE po.status = 'short_closed'
    AND po.deleted_at IS NULL
    AND jc.deleted_at IS NULL
  UNION ALL
  SELECT c.id, t.stop_at, t.depth + 1
  FROM jc_tree t
  JOIN public.job_cards c ON c.parent_job_card_id = t.id
  WHERE c.deleted_at IS NULL
    AND t.depth < 10
)
UPDATE public.job_cards j
   SET closed_at = t.stop_at,
       updated_at = now()
  FROM jc_tree t
 WHERE j.id = t.id
   AND j.closed_at IS NULL
   AND t.stop_at IS NOT NULL;
--> statement-breakpoint

-- (c) 'planned' route-card plans now fully covered → 'jc_created'.
UPDATE public.plans p
   SET plan_status = 'jc_created',
       updated_at = now()
 WHERE p.ops_source = 'route_card'
   AND p.plan_status = 'planned'
   AND p.deleted_at IS NULL
   AND EXISTS (
     SELECT 1 FROM public.production_orders po
     WHERE po.plan_id = p.id AND po.deleted_at IS NULL
   )
   AND COALESCE((
     SELECT SUM(CASE WHEN po.status IN ('closed', 'short_closed')
                     THEN COALESCE(po.credited_qty, 0) ELSE po.order_qty END)
     FROM public.production_orders po
     WHERE po.plan_id = p.id AND po.deleted_at IS NULL
   ), 0) >= p.plan_qty;
