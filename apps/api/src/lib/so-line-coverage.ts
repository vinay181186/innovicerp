// ADR-185 — ONE definition of how much of a Sales Order line is already
// planned ("covered") and how much is still to plan. Before this, three
// screens answered the same question three ways: the Plans KPI tile counted
// lines with no plan at all, the Needs Planning table counted order − plan
// qty, and SO Planning counted plans + a Buy line's PRs + direct Job Cards.
// All of them now read these expressions, which are the SO Planning rule
// (so-planning/service.ts getPlanningSoDetail step 8):
//
//   planned  = Σ plan_qty of live, non-cancelled plans on the line
//            + (Buy item only) Σ qty of the line's own standard PRs that no
//              plan raised (ADR-171; linePrFilter / NOT_A_PLAN_PR there)
//   direct   = Σ order_qty of DIRECT Job Cards for the line's OWN item: no
//              Production Order, not any plan's jc_id, not a rework / repair
//              child. The item match keeps a BOM cascade's child cards (other
//              items hanging off the parent line) from covering the parent.
//   covered  = planned + direct
//   to plan  = GREATEST(order_qty − covered, 0)
//
// `sol` is the SQL alias of the sales_order_lines row. Raw SQL on purpose, so
// it can be spliced into drizzle `sql` templates and hand-written queries.
// Callers that need more than one of these per row should compute covered
// ONCE (in a sub-select / LATERAL) and derive to-plan from it.

export function soLinePlannedRaw(sol: string): string {
  return `(
    COALESCE((SELECT SUM(p_c.plan_qty) FROM public.plans p_c
              WHERE p_c.so_line_id = ${sol}.id AND p_c.deleted_at IS NULL
                AND p_c.plan_status <> 'cancelled'), 0)
    + CASE WHEN COALESCE((SELECT i_c.procurement_type FROM public.items i_c
                          WHERE i_c.id = ${sol}.item_id), 'make') = 'buy'
           THEN COALESCE((SELECT SUM(pr_c.qty) FROM public.purchase_requests pr_c
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
  )::int`;
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
  return `(${soLinePlannedRaw(sol)} + ${soLineDirectJcRaw(sol)})::int`;
}
