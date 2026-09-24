// Production Order qty cap — the ONE place the "does this order still fit in
// its plan?" sentence is written (ADR-182).
//
// Until ADR-182 a plan raised exactly one Production Order and that order
// silently took the whole plan qty. Now a plan of 50 may be covered by 20 + 20,
// leaving 10; a third order of 30 is refused. The arithmetic and the wording
// live here, pure and unit-tested, so the message the screen shows and the
// message the server throws can never differ.
//
// `covered` is SUM(order_qty) of the plan's LIVE, non-short-closed orders —
// production-orders/service.ts reads it in SQL inside the plan's existing
// SELECT … FOR UPDATE, so two concurrent creates serialise on the plan row.
// A short-closed order is excluded on purpose: stopping an order gives its
// un-produced qty back to the plan's Pending (NAMING.md).

export interface PlanCoverage {
  /** plans.plan_qty — the whole the orders must fit inside. */
  planQty: number;
  /** SUM(order_qty) of the plan's live, non-short-closed Production Orders. */
  coveredQty: number;
  /** NAMING.md `Pending` — what a new order may still be raised for. */
  pendingQty: number;
}

/** Plan Qty / Covered / Pending, floored at 0 so bad data can only ever make
 *  Pending smaller, never negative. */
export function planCoverage(planQty: number, covered: number): PlanCoverage {
  const coveredQty = Math.max(0, Math.trunc(covered));
  return {
    planQty,
    coveredQty,
    pendingQty: Math.max(0, planQty - coveredQty),
  };
}

/**
 * Null when an order of `qty` still fits inside the plan; otherwise the exact
 * plain-English refusal.
 *
 *   nothing left at all → "Plan PLN-0009 is fully covered by its Production
 *                          Orders (50 of 50)."
 *   some left, not enough → "Plan PLN-0009 has only 10 left of 50 — reduce the
 *                            qty."
 */
export function productionOrderCapError(
  planCode: string,
  planQty: number,
  covered: number,
  qty: number,
): string | null {
  const { pendingQty } = planCoverage(planQty, covered);
  if (qty <= pendingQty) return null;
  if (pendingQty === 0) {
    return `Plan ${planCode} is fully covered by its Production Orders (${planQty} of ${planQty}).`;
  }
  return `Plan ${planCode} has only ${pendingQty} left of ${planQty} — reduce the qty.`;
}

/**
 * Null when a plan may still be re-typed to `planQty`; otherwise the refusal.
 *
 * A plan of 50 with a live Production Order for 20 may be cut back to 20, but
 * not to 10: the order (and the Job Card built from it) is for pieces the plan
 * would then not contain, Covered would exceed Plan Qty, Pending would floor at
 * 0 and the plan would read "production complete" while work is running
 * (ADR-182 review). `covered` is the same SUM the cap above uses, so a
 * short-closed order never holds the plan down.
 *
 *   "Plan PLN-0009 already has Production Orders for 20 — Plan Qty cannot be
 *    less than that."
 */
export function planQtyBelowCoveredError(
  planCode: string,
  planQty: number,
  covered: number,
): string | null {
  const coveredQty = Math.max(0, Math.trunc(covered));
  if (coveredQty === 0 || planQty >= coveredQty) return null;
  return (
    `Plan ${planCode} already has Production Orders for ${coveredQty} — ` +
    `Plan Qty cannot be less than that.`
  );
}
