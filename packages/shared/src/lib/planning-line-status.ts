// How planned is one SO/JWSO Planning line? ONE rule, in ONE place.
//
// Before this file the question had two answers that could disagree. The API
// filled `lineStatus` from a coverage percentage, and the web threw that away
// and worked the state out again from `remaining` plus the plan statuses. On a
// line whose whole qty is covered by a plan that is still a DRAFT, the API said
// `fully_planned` while the screen said "In Planning" — the same line, two
// answers (CLAUDE.md §20.1: one number, one writer).
//
// The web's rule is the right one, because green must mean work was actually
// let out, not "somebody typed a plan for the full qty". So it moved here, and
// both sides read it:
//   - the API fills `PlanningLine.lineStatus` from `planningLineStatus().state`
//     (mapped to the three values that field has always carried);
//   - the web renders `label`/`pct` and maps `state` to a colour.
//
// Pure arithmetic: no database, no React, no colours. Colours stay in the web,
// because a token name means nothing on the server.

/** Every state a Planning line can be in, most planned last. */
export type PlanningLineState =
  /** Nothing covers this line yet. */
  | 'unplanned'
  /** Something covers part of it; qty is still left to plan. */
  | 'partly_planned'
  /** Fully covered, but at least one plan is still a draft — no JC/PR yet. */
  | 'in_planning'
  /** Fully covered only by Job Cards raised outside a plan. */
  | 'in_production_no_plan'
  /** Fully covered and every plan has been let out as a JC or a PR. */
  | 'fully_planned';

/** The three values `PlanningLine.lineStatus` has always carried. */
export type PlanningLineStatus = 'fully_planned' | 'partial' | 'unplanned';

/** Only the fields the rule reads — so the API can call it on a row it is
 *  still building, before a full `PlanningLine` exists. */
export interface PlanningLineStatusInput {
  orderQty: number;
  /** Still to plan: max(0, orderQty − planned − direct JCs). */
  remaining: number;
  /** Sum of the live plans' qty. */
  totalPlanned: number;
  /** Qty on Job Cards raised straight off the SO, with no plan. */
  directJcQty: number;
  /** The live plans on this line — only their status is read. */
  plans: readonly { planStatus: string }[];
}

/** A plan whose work has actually been let out: a Job Card exists, a purchase
 *  request was raised, it is running, or it finished. A plan sitting in
 *  `in_planning` or `planned` has NOT been let out. */
export function isPlanExecuted(planStatus: string): boolean {
  return (
    planStatus === 'jc_created' ||
    planStatus === 'pr_created' ||
    planStatus === 'in_production' ||
    planStatus === 'complete'
  );
}

export interface PlanningLineStatusResult {
  state: PlanningLineState;
  /** What the line reads on screen, e.g. `Partly Planned (450 pending)`. */
  label: string;
  /** 0–100: covered qty (plans + plan-less Job Cards) over order qty. */
  pct: number;
  /** True when a Job Card was raised against this line with no plan. */
  hasDirectJc: boolean;
}

/**
 * The state, the on-screen label and the covered percentage for one line.
 *
 * `pct` is capped at 100 and is 0 for a zero-qty line, so it is always a
 * number a progress bar can use. The label carries the pending qty because a
 * planner reads "how much is left", not "what fraction is done".
 */
export function planningLineStatus(line: PlanningLineStatusInput): PlanningLineStatusResult {
  const hasDirectJc = line.directJcQty > 0;
  const hasPlans = line.plans.length > 0;
  const allPlansExecuted = hasPlans && line.plans.every((p) => isPlanExecuted(p.planStatus));
  const covered = line.remaining <= 0;

  const coveredQty = Math.min(line.orderQty, line.totalPlanned + line.directJcQty);
  const pct = line.orderQty > 0 ? Math.min(100, Math.round((coveredQty / line.orderQty) * 100)) : 0;

  const state: PlanningLineState = covered
    ? !hasPlans && hasDirectJc
      ? 'in_production_no_plan'
      : hasPlans && !allPlansExecuted
        ? 'in_planning'
        : 'fully_planned'
    : hasPlans || hasDirectJc
      ? 'partly_planned'
      : 'unplanned';

  const label =
    state === 'in_production_no_plan'
      ? 'In Production (no plan)'
      : state === 'in_planning'
        ? 'In Planning'
        : state === 'fully_planned'
          ? 'Fully Planned'
          : state === 'partly_planned'
            ? `Partly Planned (${line.remaining} pending)`
            : 'Unplanned';

  return { state, label, pct, hasDirectJc };
}

/**
 * The five states folded into the three values `PlanningLine.lineStatus`
 * carries on the wire. A line covered only by draft plans is NOT reported as
 * fully planned — that is the disagreement this file exists to end.
 */
export function toPlanningLineStatus(state: PlanningLineState): PlanningLineStatus {
  if (state === 'fully_planned' || state === 'in_production_no_plan') return 'fully_planned';
  if (state === 'unplanned') return 'unplanned';
  return 'partial';
}
