// RC No. / PRO No. / JC No. of a planning line (owner-approved 2026-10-26;
// moved here for ADR-268). ONE rule for which documents a line has produced, so
// the screen's cells and the server's search + Sort & Filter on the Planning
// list can never read differently. Pure — no React, no database.
//
// Nothing generated yet → the word "Pending" (NAMING.md).

import { ROUTE_CARD_APPROVAL_LABEL } from '../enums/route-card-approval';
import type { PlanningLine, PlanningPlanSummary } from '../schemas/so-planning';

type RcApproval = PlanningPlanSummary['routeCardApprovalStatus'];

export interface PlanningRcRef {
  code: string;
  approval: RcApproval;
}
export interface PlanningDocRef {
  code: string;
  /** Detail-page id; null → plain text. */
  id: string | null;
}

/** Only what the rule reads, so a list row and a full PlanningLine both fit. */
export type PlanningLineDocsInput = Pick<PlanningLine, 'plans' | 'directJcCodes'>;

/** The plan's Route Card, or none. */
export function planRouteCards(plan: PlanningPlanSummary): PlanningRcRef[] {
  return plan.routeCardCode
    ? [{ code: plan.routeCardCode, approval: plan.routeCardApprovalStatus }]
    : [];
}

/** Every live Production Order of the plan, oldest first. An older API build
 *  sends no list — fall back to the single newest PRO it does send. */
export function planPros(plan: PlanningPlanSummary): PlanningDocRef[] {
  if (plan.productionOrders.length === 0 && plan.productionOrderCode) {
    return [{ code: plan.productionOrderCode, id: plan.productionOrderId }];
  }
  return plan.productionOrders.map((po) => ({ code: po.code, id: po.id }));
}

/** A Job Card the plan made itself (Execute on an ops-editor plan), not through
 *  a PRO — it was in the old "Linked" cell and must not disappear. */
export function planOwnJc(plan: PlanningPlanSummary): PlanningDocRef | null {
  if (!plan.jcCode) return null;
  if (plan.productionOrders.some((po) => po.jcCode === plan.jcCode)) return null;
  return { code: plan.jcCode, id: plan.jcId };
}

/** The Job Card of each PRO, same order (a JC in Trash comes back null →
 *  skipped), then the plan's own Job Card if it has one. */
export function planJcs(plan: PlanningPlanSummary): PlanningDocRef[] {
  const own = planOwnJc(plan);
  return [
    ...plan.productionOrders
      .filter((po) => po.jcCode)
      .map((po) => ({ code: po.jcCode as string, id: po.jobCardId })),
    ...(own ? [own] : []),
  ];
}

/** Unique Route Cards across the line's plans (a card's approval is one value,
 *  so the first plan naming it speaks for all). */
export function lineRouteCards(line: Pick<PlanningLine, 'plans'>): PlanningRcRef[] {
  const byCode = new Map<string, PlanningRcRef>();
  for (const p of line.plans) {
    for (const rc of planRouteCards(p)) if (!byCode.has(rc.code)) byCode.set(rc.code, rc);
  }
  return [...byCode.values()];
}

export function linePros(line: Pick<PlanningLine, 'plans'>): PlanningDocRef[] {
  return line.plans.flatMap(planPros);
}

/** PRO Job Cards across the line's plans, then the plan-less (direct) ones. */
export function lineJcs(line: PlanningLineDocsInput): PlanningDocRef[] {
  const out: PlanningDocRef[] = line.plans.flatMap(planJcs);
  const seen = new Set(out.map((j) => j.code));
  for (const code of line.directJcCodes) {
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({ code, id: null });
  }
  return out;
}

/** The ADR-253 warning beside a card not yet approved; none once approved. */
export function rcApprovalLabel(a: RcApproval): string | null {
  return a === 'pending' || a === 'rejected' ? ROUTE_CARD_APPROVAL_LABEL[a] : null;
}

/** Plain text — the cell's tooltip and what Sort & Filter reads. */
export function rcText(rcs: PlanningRcRef[]): string {
  if (rcs.length === 0) return 'Pending';
  return rcs
    .map((rc) => [rc.code, rcApprovalLabel(rc.approval)].filter(Boolean).join(' '))
    .join(' · ');
}
export function docText(docs: PlanningDocRef[]): string {
  return docs.length === 0 ? 'Pending' : docs.map((d) => d.code).join(' · ');
}
