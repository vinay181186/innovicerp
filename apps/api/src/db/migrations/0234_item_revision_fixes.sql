-- ============================================================
-- 0234_item_revision_fixes
-- Code-review fixes for the Drawing Rev register (0232) and stock per Rev
-- (0233). Data + one view; no table or column changes.
--
--   1. Reservations backfilled by 0233 to a Rev bucket that never held stock
--      (0233 put ALL old stock in the blank bucket, but copied the order
--      line's Rev onto the booking) go back to the blank bucket: a booking
--      with a Rev and no ledger row for that Item + Rev at all.
--   2. v_item_rev_stock_availability: a bucket that has bookings but no
--      balance row was dropped by the LEFT JOIN — now a FULL JOIN of the two
--      key sets (same columns, same order, same types).
--   3. JWSO lines carry the server default revision '0' (nobody typed it);
--      0232 registered it as a real Rev "<item>/0". Unlink those lines and
--      the plans / Production Orders / Job Cards that inherited the link from
--      them, then soft-delete the '0' register rows nothing references any
--      more. SO lines with '0' were typed by a user (SO Rev is compulsory)
--      and stay linked — so a '0' row an SO line uses is kept.
-- Idempotent (every step re-checks). Apply: DB_TARGET=TEST|PROD … apply-sql.ts.
-- ============================================================

-- ── 1. Reservations with a Rev whose bucket never held stock → blank ──
UPDATE public.so_stock_reservations s
   SET item_revision_id = NULL
 WHERE s.item_revision_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.store_transactions t
      WHERE t.company_id = s.company_id AND t.item_id = s.item_id
        AND t.item_revision_id = s.item_revision_id
   );
--> statement-breakpoint

-- ── 2. Availability per Rev bucket — keep buckets that only have bookings ──
CREATE OR REPLACE VIEW public.v_item_rev_stock_availability
  WITH (security_invoker = true) AS
SELECT COALESCE(b.company_id, r.company_id) AS company_id,
       COALESCE(b.item_id, r.item_id) AS item_id,
       COALESCE(b.rev_key, r.rev_key) AS rev_key,
       COALESCE(b.item_revision_id,
                NULLIF(r.rev_key, '00000000-0000-0000-0000-000000000000'::uuid)) AS item_revision_id,
       COALESCE(b.on_hand_qty, 0)::numeric(14,3) AS on_hand_qty,
       COALESCE(r.reserved_qty, 0)::numeric(14,3) AS reserved_qty,
       (COALESCE(b.on_hand_qty, 0) - COALESCE(r.reserved_qty, 0))::numeric(14,3) AS free_qty
FROM public.item_rev_stock_balances b
FULL JOIN (
  SELECT x.company_id, x.item_id, x.rev_key, SUM(x.held) AS reserved_qty
  FROM (
    SELECT company_id, item_id,
           COALESCE(item_revision_id, '00000000-0000-0000-0000-000000000000'::uuid) AS rev_key,
           (qty - consumed_qty - released_qty)::numeric AS held
    FROM public.so_stock_reservations
    WHERE deleted_at IS NULL AND status IN ('active', 'partially_consumed')
    UNION ALL
    SELECT company_id, item_id,
           COALESCE(item_revision_id, '00000000-0000-0000-0000-000000000000'::uuid),
           (qty - consumed_qty - released_qty)::numeric
    FROM public.assembly_part_reservations
    WHERE deleted_at IS NULL AND status IN ('active', 'partially_consumed')
  ) x
  GROUP BY x.company_id, x.item_id, x.rev_key
) r ON r.company_id = b.company_id AND r.item_id = b.item_id AND r.rev_key = b.rev_key;
--> statement-breakpoint
GRANT SELECT ON public.v_item_rev_stock_availability TO authenticated;
--> statement-breakpoint

-- ── 3a. Job Cards / PROs / plans that inherited a JWSO line's '0' link ──
-- (children first, while the line still names the Rev they copied)
UPDATE public.job_cards j
   SET item_revision_id = NULL
  FROM public.job_work_order_lines l
 WHERE UPPER(TRIM(l.revision)) = '0' AND l.item_revision_id IS NOT NULL
   AND j.source_jw_line_id = l.id AND j.company_id = l.company_id
   AND j.item_revision_id = l.item_revision_id;
--> statement-breakpoint
UPDATE public.production_orders po
   SET item_revision_id = NULL
  FROM public.plans p
  JOIN public.job_work_order_lines l ON l.id = p.jw_line_id AND l.company_id = p.company_id
 WHERE UPPER(TRIM(l.revision)) = '0' AND l.item_revision_id IS NOT NULL
   AND po.plan_id = p.id AND po.company_id = p.company_id
   AND po.item_revision_id = l.item_revision_id;
--> statement-breakpoint
UPDATE public.job_cards j
   SET item_revision_id = NULL
  FROM public.production_orders po
  JOIN public.plans p ON p.id = po.plan_id AND p.company_id = po.company_id
  JOIN public.job_work_order_lines l ON l.id = p.jw_line_id AND l.company_id = p.company_id
 WHERE UPPER(TRIM(l.revision)) = '0' AND l.item_revision_id IS NOT NULL
   AND j.production_order_id = po.id AND j.company_id = po.company_id
   AND j.item_revision_id = l.item_revision_id;
--> statement-breakpoint
UPDATE public.plans p
   SET item_revision_id = NULL
  FROM public.job_work_order_lines l
 WHERE UPPER(TRIM(l.revision)) = '0' AND l.item_revision_id IS NOT NULL
   AND p.jw_line_id = l.id AND p.company_id = l.company_id
   AND p.item_revision_id = l.item_revision_id;
--> statement-breakpoint

-- ── 3b. The JWSO lines themselves ──
UPDATE public.job_work_order_lines
   SET item_revision_id = NULL
 WHERE UPPER(TRIM(revision)) = '0' AND item_revision_id IS NOT NULL;
--> statement-breakpoint

-- ── 3c. Soft-delete '0' register rows nothing points at any more ──
UPDATE public.item_revisions r
   SET deleted_at = now(), updated_at = now()
 WHERE r.rev = '0' AND r.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.sales_order_lines x WHERE x.item_revision_id = r.id)
   AND NOT EXISTS (SELECT 1 FROM public.job_work_order_lines x WHERE x.item_revision_id = r.id)
   AND NOT EXISTS (SELECT 1 FROM public.route_cards x WHERE x.item_revision_id = r.id)
   AND NOT EXISTS (SELECT 1 FROM public.plans x WHERE x.item_revision_id = r.id)
   AND NOT EXISTS (SELECT 1 FROM public.production_orders x WHERE x.item_revision_id = r.id)
   AND NOT EXISTS (SELECT 1 FROM public.job_cards x WHERE x.item_revision_id = r.id)
   AND NOT EXISTS (SELECT 1 FROM public.bom_master_lines x WHERE x.child_item_revision_id = r.id)
   AND NOT EXISTS (SELECT 1 FROM public.ml_bom_lines x WHERE x.child_item_revision_id = r.id)
   AND NOT EXISTS (SELECT 1 FROM public.ml_plan_nodes x WHERE x.item_revision_id = r.id)
   AND NOT EXISTS (SELECT 1 FROM public.store_transactions x WHERE x.item_revision_id = r.id)
   AND NOT EXISTS (SELECT 1 FROM public.item_rev_stock_balances x WHERE x.item_revision_id = r.id)
   AND NOT EXISTS (SELECT 1 FROM public.so_stock_reservations x WHERE x.item_revision_id = r.id)
   AND NOT EXISTS (SELECT 1 FROM public.assembly_part_reservations x WHERE x.item_revision_id = r.id)
   AND NOT EXISTS (SELECT 1 FROM public.customer_dispatch_lines x WHERE x.item_revision_id = r.id)
   AND NOT EXISTS (SELECT 1 FROM public.stock_count_lines x WHERE x.item_revision_id = r.id)
   AND NOT EXISTS (SELECT 1 FROM public.item_revision_changes x
                    WHERE x.from_item_revision_id = r.id OR x.to_item_revision_id = r.id);

-- ------------------------------------------------------------
-- DOWN (rollback reference only — NOT run by apply-sql).
-- 2. Re-run section 6 of 0233 (the LEFT JOIN view).
-- 1 / 3 are data corrections of wrong backfill values; not reversed.
-- ------------------------------------------------------------
