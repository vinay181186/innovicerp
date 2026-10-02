// Shared constants, types and tiny helpers for the SO/JWSO Planning workflow
// (PL-4b). Split out of routes/workflow.tsx (ADR-199 table standard) so that
// file and each view component stay under the 400-line rule. Behaviour is
// unchanged — this is the same code, relocated so both the SO list, the line
// search and the per-order detail can share one copy.

import type { PlanningLine, PlanningSoListItem } from '@innovic/shared';

/** Which orders level 1 lists — a sales order or a job-work order. */
export type Source = 'so' | 'jw';

export type ModalState =
  | { kind: 'none' }
  | { kind: 'create'; soLineId: string }
  | { kind: 'raise-pr'; soLineId: string }
  | { kind: 'allocate'; soLineId: string }
  | { kind: 'release'; soLineId: string }
  | { kind: 'edit'; planId: string }
  | { kind: 'equip-bom'; soLineId: string }
  | { kind: 'assembly-bom'; soLineId: string };

export const ORDER_STATUS_LABEL: Record<PlanningSoListItem['planningStatus'], string> = {
  fully_planned: 'Fully Planned',
  partial: 'Partly Planned',
  unplanned: 'Unplanned',
};

export const ORDER_STATUS_BADGE: Record<PlanningSoListItem['planningStatus'], string> = {
  fully_planned: 'b-green',
  partial: 'b-amber',
  unplanned: 'b-grey',
};

/** Small purple "JW" tag next to a Job Work order's number. */
export function JwChip(): JSX.Element {
  return (
    <span className="tag" style={{ color: 'var(--purple)', background: 'var(--bg4)' }}>
      JW
    </span>
  );
}

// Plan/line lifecycle → the status label + colour a line is shown with. ONE
// helper, used by the line row AND the search-results row, so the two views
// can never disagree about what a line's state is.
//  - "executed" = work actually allocated: JC created, outsource/direct PR
//    raised, in production, or complete.
//  - covered but plan still a draft (in_planning/planned) → "In Planning"
//  - covered AND every plan executed → "Fully Planned"
//  - covered only by a plan-less direct JC → "In Production (no plan)"
// Green must mean executed, NOT "a draft plan exists for the full qty".
export function lineStatusOf(line: PlanningLine): {
  label: string;
  color: string;
  /** 0–100: covered qty (plans + in-production direct JCs) over order qty. */
  pct: number;
  hasDirectJc: boolean;
} {
  const totalQty = line.orderQty;
  const hasDirectJc = line.directJcQty > 0;
  const planExecuted = (s: string): boolean =>
    s === 'jc_created' || s === 'pr_created' || s === 'in_production' || s === 'complete';
  const allPlansExecuted =
    line.plans.length > 0 && line.plans.every((p) => planExecuted(p.planStatus));
  const coveredByDraftPlans = line.remaining <= 0 && line.plans.length > 0 && !allPlansExecuted;

  const coveredQty = Math.min(totalQty, line.totalPlanned + line.directJcQty);
  const pct = totalQty > 0 ? Math.min(100, Math.round((coveredQty / totalQty) * 100)) : 0;
  const label =
    line.remaining <= 0
      ? line.plans.length === 0 && hasDirectJc
        ? 'In Production (no plan)'
        : coveredByDraftPlans
          ? 'In Planning'
          : 'Fully Planned'
      : line.plans.length > 0 || hasDirectJc
        ? `Partly Planned (${line.remaining} pending)`
        : 'Unplanned';
  const color =
    line.remaining <= 0
      ? line.plans.length === 0 && hasDirectJc
        ? 'var(--cyan)'
        : coveredByDraftPlans
          ? 'var(--amber)'
          : 'var(--green)'
      : line.plans.length > 0 || hasDirectJc
        ? 'var(--amber)'
        : 'var(--text3)';
  return { label, color, pct, hasDirectJc };
}
