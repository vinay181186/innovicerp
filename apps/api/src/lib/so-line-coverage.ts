// ADR-185 — ONE definition of how much of a Sales Order line is already
// planned ("covered") and how much is still to plan. Before this, three
// screens answered the same question three ways: the Plans KPI tile counted
// lines with no plan at all, the Needs Planning table counted order − plan
// qty, and SO Planning counted plans + a Buy line's PRs + direct Job Cards.
// All of them now read these expressions, which are the SO Planning rule
// (so-planning/service.ts getPlanningSoDetail step 8).
//
// ADR-221 — BOM PART plans no longer add into the line. Before, every plan
// on the line was summed, so IN-SO-00793 (order 10, part plans P1 10 + P2 10)
// read "Plan Qty 20". The rule is packages/shared soLinePlanCoverage; these
// expressions are its SQL mirror (so-line-coverage.test.ts holds them
// together):
//
//   part plan = a plan carrying BOTH bom_master_id and bom_child_code
//               (ADR-107's own test). Every other plan is the line's OWN.
//   own      = Σ plan_qty of live, non-cancelled OWN plans on the line
//            + (Buy item only) Σ qty of the line's own standard PRs that no
//              plan raised (ADR-171; linePrFilter / NOT_A_PLAN_PR there) —
//              a balance-closed PR counts only what was ordered (prCoverQtyRaw)
//   sets     = THE EQUIPMENT line only: sales_orders.type = 'equipment', a
//              live header Equipment BOM, and this line's item is that BOM's
//              parent_item_id (the machine). A spare-part line on the same SO
//              is ordinary. The header BOM's live lines (qty_per_set > 0) are
//              grouped by child code with qty_per_set SUMMED (a part on two
//              BOM lines needs both); sets = MIN over codes of FLOOR(Σ part
//              plan_qty for that code ÷ summed qty_per_set) — the weakest part
//              decides — capped at the line's order qty (LEAST). No usable BOM
//              line → 0. Every other line (ordinary, assembly) → 0: an
//              assembly line is planned by its Final Assembly plan only.
//   planned  = GREATEST(own, sets)
//   direct   = Σ order_qty of DIRECT Job Cards for the line's OWN item: no
//              Production Order, not any plan's jc_id, not a rework / repair
//              child. The item match keeps a BOM cascade's child cards (other
//              items hanging off the parent line) from covering the parent.
//   covered  = planned + direct
//   to plan  = GREATEST(order_qty − covered, 0)
//
// soLineOwnPlannedRaw / soLineOwnCoveredRaw (own, own + direct) are the CAP
// for a new OWN plan: part plans have their own per-part cap (ADR-107) and
// must not eat the line's allowance. A Buy line's PR (Raise PR from Planning)
// is capped by the FULL covered figure, so a Buy equipment line whose parts
// are planned cannot take a PR on top.
//
// `sol` is the SQL alias of the sales_order_lines row. Raw SQL on purpose, so
// it can be spliced into drizzle `sql` templates and hand-written queries.
// Callers that need more than one of these per row should compute covered
// ONCE (in a sub-select / LATERAL) and derive to-plan from it.
//
// planned / covered are ::numeric, not ::int: a Buy line's PR qty is decimal
// since 0172 (KGS / MTR), and ::int would ROUND 9.5 to 10. The direct Job Card
// part stays whole — JC piece counts are always integers. Read with Number().

/**
 * ADR-189 — how much of an SO line one PR covers: its qty, or — once its
 * balance was closed — only what was really ordered on live POs (a short-closed
 * PO counting what it received), so the abandoned remainder is to-plan again.
 * Mirrors purchase-requests liveOrderedQtySql. `pr` is the PR row alias.
 */
export function prCoverQtyRaw(pr: string): string {
  return `(CASE WHEN ${pr}.balance_closed_at IS NULL THEN ${pr}.qty
    ELSE (SELECT COALESCE(SUM(CASE WHEN po_v.short_closed_at IS NOT NULL
                                   THEN COALESCE(pol_v.received_qty, 0) ELSE pol_v.qty END), 0)
          FROM public.purchase_order_lines pol_v
          JOIN public.purchase_orders po_v ON po_v.id = pol_v.purchase_order_id
          WHERE pol_v.source_pr_id = ${pr}.id AND pol_v.deleted_at IS NULL
            AND po_v.deleted_at IS NULL AND po_v.status <> 'cancelled')
    END)`;
}

/**
 * ADR-221 — a plan is a BOM PART plan when it carries BOTH bom_master_id and
 * bom_child_code (packages/shared isBomPartPlan; '' counts as blank there, so
 * NULLIF here). `p` is the plans row alias.
 */
export function isBomPartPlanRaw(p: string): string {
  return `(${p}.bom_master_id IS NOT NULL AND NULLIF(${p}.bom_child_code, '') IS NOT NULL)`;
}

/** ADR-221 — the line's OWN plans (no part plans) + a Buy line's own PRs. */
export function soLineOwnPlannedRaw(sol: string): string {
  return `(
    COALESCE((SELECT SUM(p_c.plan_qty) FROM public.plans p_c
              WHERE p_c.so_line_id = ${sol}.id AND p_c.deleted_at IS NULL
                AND p_c.plan_status <> 'cancelled'
                AND NOT ${isBomPartPlanRaw('p_c')}), 0)
    + CASE WHEN COALESCE((SELECT i_c.procurement_type FROM public.items i_c
                          WHERE i_c.id = ${sol}.item_id), 'make') = 'buy'
           THEN COALESCE((SELECT SUM(${prCoverQtyRaw('pr_c')}) FROM public.purchase_requests pr_c
                          WHERE pr_c.source_so_line_id = ${sol}.id
                            AND pr_c.deleted_at IS NULL
                            AND pr_c.source_jc_op_id IS NULL
                            AND pr_c.pr_type = 'standard'
                            AND pr_c.status <> 'cancelled'
                            AND NOT EXISTS (
                              SELECT 1 FROM public.plans pp_c
                              WHERE pp_c.deleted_at IS NULL
                                AND pr_c.id IN (pp_c.dp_pr_id, pp_c.fo_pr_id,
                                                pp_c.fo_mat_pr_id, pp_c.material_pr_id))), 0)
           ELSE 0 END
  )::numeric`;
}

/**
 * ADR-221 — true when `sol` is THE equipment line: an Equipment SO whose live
 * header BOM's parent item is this line's item. Same test as
 * so-planning getPlanningSoDetail's per-line isEquipmentLine.
 */
export function soLineIsEquipmentLineRaw(sol: string): string {
  return `EXISTS (SELECT 1 FROM public.sales_orders soe_c
                  JOIN public.bom_masters bme_c
                    ON bme_c.id = soe_c.bom_master_id AND bme_c.deleted_at IS NULL
                  WHERE soe_c.id = ${sol}.sales_order_id
                    AND soe_c.type = 'equipment'
                    AND bme_c.parent_item_id = ${sol}.item_id)`;
}

/**
 * ADR-221 — complete sets the line's part plans make, THE equipment line only
 * (0 otherwise). Mirrors packages/shared completeSets: qty per set summed per
 * child code, MIN over codes of FLOOR(planned ÷ qty per set), capped at the
 * order qty. Numeric is exact here, so no float slack is needed. Child code =
 * items.code via bom_master_lines.child_item_id, the join ADR-107's cap uses.
 * LEAST ignores NULLs, so the MIN is COALESCEd first — never LEAST(NULL, qty).
 */
export function soLineEquipmentSetsRaw(sol: string): string {
  return `LEAST(COALESCE((
    SELECT MIN(FLOOR(
             COALESCE((SELECT SUM(ps_c.plan_qty) FROM public.plans ps_c
                       WHERE ps_c.so_line_id = ${sol}.id AND ps_c.deleted_at IS NULL
                         AND ps_c.plan_status <> 'cancelled'
                         AND ${isBomPartPlanRaw('ps_c')}
                         AND ps_c.bom_child_code = q_c.code), 0)::numeric
             / q_c.qps))
    FROM public.sales_orders so_c
    JOIN public.bom_masters bm_c
      ON bm_c.id = so_c.bom_master_id AND bm_c.deleted_at IS NULL
    JOIN LATERAL (
      SELECT ib_c.code, SUM(bml_c.qty_per_set) AS qps
      FROM public.bom_master_lines bml_c
      JOIN public.items ib_c ON ib_c.id = bml_c.child_item_id
      WHERE bml_c.bom_master_id = bm_c.id
        AND bml_c.deleted_at IS NULL AND bml_c.qty_per_set > 0
      GROUP BY ib_c.code
    ) q_c ON TRUE
    WHERE so_c.id = ${sol}.sales_order_id
      AND so_c.type = 'equipment'
      AND bm_c.parent_item_id = ${sol}.item_id), 0), GREATEST(${sol}.order_qty, 0))::numeric`;
}

/** ADR-221 — what the line counts as planned: GREATEST(own, sets). */
export function soLinePlannedRaw(sol: string): string {
  return `GREATEST(${soLineOwnPlannedRaw(sol)}, ${soLineEquipmentSetsRaw(sol)})::numeric`;
}

export function soLineDirectJcRaw(sol: string): string {
  return `COALESCE((SELECT SUM(jc_c.order_qty) FROM public.job_cards jc_c
              WHERE jc_c.source_so_line_id = ${sol}.id AND jc_c.deleted_at IS NULL
                AND jc_c.item_id IS NOT DISTINCT FROM ${sol}.item_id
                AND jc_c.recovery_kind IS NULL AND jc_c.production_order_id IS NULL
                AND NOT EXISTS (SELECT 1 FROM public.plans pj_c
                                WHERE pj_c.jc_id = jc_c.id AND pj_c.deleted_at IS NULL
                                  AND pj_c.plan_status <> 'cancelled')), 0)::int`;
}

export function soLineCoveredRaw(sol: string): string {
  return `(${soLinePlannedRaw(sol)} + ${soLineDirectJcRaw(sol)})::numeric`;
}

/** ADR-221 — the cap for a new OWN plan: own planned + direct cards. */
export function soLineOwnCoveredRaw(sol: string): string {
  return `(${soLineOwnPlannedRaw(sol)} + ${soLineDirectJcRaw(sol)})::numeric`;
}
