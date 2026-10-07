// ADR-221 — how much of a Sales Order line its PLANS cover, ONE rule for the
// Planning screen (TypeScript) and every SQL reader (apps/api/src/lib/
// so-line-coverage.ts mirrors it; a parity test holds them together).
//
// The fault this replaces: every plan on the line was summed, BOM part plans
// included, so IN-SO-00793 (order 10, parts P1 10 + P2 10) read "Plan Qty 20".
// ADR-216 left it open on purpose until all readers could change together.
//
//   A plan is a PART plan when it carries BOTH bom_master_id and
//   bom_child_code (ADR-107's own test). Every other plan is the line's OWN.
//
//   EQUIPMENT line — the machine itself is never planned (owner 2026-10-07,
//     ADR-221 a); only its parts are. Planned = COMPLETE SETS: for each part
//     on the SO's Equipment BOM, floor(part planned ÷ qty per set); the
//     weakest part decides. P1 10 + P2 4 at 1 per set → 4 sets.
//     A legacy own plan on such a line still counts: planned = the larger of
//     the two, so adding a plan can never make the figure go down.
//
//   Every other line (ordinary, ASSEMBLY) — planned = its OWN plans only. An
//     assembly line's part plans do not cover it: it is planned when its
//     Final Assembly plan exists (owner 2026-10-07, ADR-221 b), so it stays in
//     Needs Planning until then.
//
//   A Buy line's own standard PRs count as planned, as before (ADR-171) —
//   passed in as `buyPrQty`, already 0 on a make line.

export interface SoLinePlanCoverageInput {
  /** THE equipment line: an Equipment SO with an Equipment BOM on its header,
   *  and this line's item is that BOM's parent (the machine). Any other line
   *  on an Equipment SO — a spare part — is an ordinary line. */
  isEquipmentLine: boolean;
  /** The line's order qty — sets never count above it (a fractional qty per
   *  set can round the per-part cap up past one more set). */
  orderQty: number;
  /** Live, non-cancelled plans on the line. */
  plans: ReadonlyArray<{
    planQty: number;
    bomMasterId: string | null;
    bomChildCode: string | null;
  }>;
  /** The Equipment BOM's parts (code = items.code, as bom_child_code holds). */
  bomLines: ReadonlyArray<{ code: string; qtyPerSet: number }>;
  /** A Buy line's own PR qty (ADR-171); 0 on a make line. */
  buyPrQty: number;
}

export interface SoLinePlanCoverage {
  /** The line's own plans (+ a Buy line's PRs). The cap for a new own plan. */
  ownPlanned: number;
  /** Complete sets from part plans — 0 unless an equipment line. */
  sets: number;
  /** What the line counts as planned (Plan Qty, Remaining, status, lists). */
  planned: number;
}

/** A plan for one BOM part — ADR-107's test, everywhere. */
export function isBomPartPlan(p: {
  bomMasterId: string | null;
  bomChildCode: string | null;
}): boolean {
  return Boolean(p.bomMasterId) && Boolean(p.bomChildCode);
}

/** Float slack for floor(): 7 / 0.07 is 99.99999999999999 in JS but exactly
 *  100 in Postgres numeric — without it the screen and SQL differ by one set. */
const FLOOR_EPS = 1e-9;

/** Complete sets the part plans make, the weakest part deciding. A part that
 *  sits on two BOM lines needs both lines' qty per set, so qty per set is
 *  summed per part code first (the SQL twin groups the same way). */
export function completeSets(
  bomLines: ReadonlyArray<{ code: string; qtyPerSet: number }>,
  partPlanned: ReadonlyMap<string, number>,
): number {
  const perSet = new Map<string, number>();
  for (const b of bomLines) {
    if (b.qtyPerSet > 0) perSet.set(b.code, (perSet.get(b.code) ?? 0) + b.qtyPerSet);
  }
  if (perSet.size === 0) return 0;
  let sets = Infinity;
  for (const [code, q] of perSet) {
    sets = Math.min(sets, Math.floor((partPlanned.get(code) ?? 0) / q + FLOOR_EPS));
  }
  return Number.isFinite(sets) ? sets : 0;
}

export function soLinePlanCoverage(input: SoLinePlanCoverageInput): SoLinePlanCoverage {
  let own = 0;
  const partPlanned = new Map<string, number>();
  for (const p of input.plans) {
    if (isBomPartPlan(p)) {
      const code = p.bomChildCode as string;
      partPlanned.set(code, (partPlanned.get(code) ?? 0) + p.planQty);
    } else {
      own += p.planQty;
    }
  }
  const ownPlanned = own + input.buyPrQty;
  const sets = input.isEquipmentLine
    ? Math.min(completeSets(input.bomLines, partPlanned), Math.max(0, input.orderQty))
    : 0;
  return { ownPlanned, sets, planned: Math.max(ownPlanned, sets) };
}
