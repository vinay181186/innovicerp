// Shared constants, types and tiny helpers for the SO/JWSO Planning workflow
// (PL-4b). Split out of routes/workflow.tsx (ADR-199 table standard) so that
// file and each view component stay under the 400-line rule. Behaviour is
// unchanged — this is the same code, relocated so both the SO list, the line
// search and the per-order detail can share one copy.

import { planningLineStatus } from '@innovic/shared';
import type { PlanningLine, PlanningLineState, PlanningSoListItem } from '@innovic/shared';

/** Which orders level 1 lists — a sales order or a job-work order. */
export type Source = 'so' | 'jw';

/** The level-1 source dropdown: one source, or both together ('all', default). */
export type SourceFilter = Source | 'all';

/** Count/footer noun for the level-1 list. */
export function sourceNoun(src: SourceFilter): string {
  return src === 'jw' ? 'JWSO' : src === 'so' ? 'SO' : 'SO / JWSO';
}

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

/** Each line state → the colour it is shown in. The COLOUR is all the web adds
 *  to the shared rule: a token name means nothing on the server, so
 *  `planningLineStatus()` (packages/shared) owns the state, the label and the
 *  percentage, and this map owns nothing else. */
const LINE_STATE_COLOR: Record<PlanningLineState, string> = {
  in_production_no_plan: 'var(--cyan)',
  in_planning: 'var(--amber)',
  fully_planned: 'var(--green)',
  partly_planned: 'var(--amber)',
  unplanned: 'var(--text3)',
};

// Plan/line lifecycle → the status label + colour a line is shown with. ONE
// helper, used by the line table AND the search-results row, so the two views
// can never disagree about what a line's state is — and it is now a thin
// wrapper over `planningLineStatus()` in packages/shared, so the API and the
// screen cannot disagree either (the rule used to be written out twice).
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
  const { state, label, pct, hasDirectJc } = planningLineStatus(line);
  return { label, color: LINE_STATE_COLOR[state], pct, hasDirectJc };
}
