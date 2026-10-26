// RC No. / PRO No. / JC No. on SO + JWSO Planning (owner-approved 2026-10-26).
// ONE place that turns a line's (or one plan's) Route Card, Production Orders
// and Job Cards into codes, so the line table (planning-line-columns.tsx) and
// the ▸ panel (planning-line-expand.tsx) can never read differently.
//
// Nothing generated yet → the grey word "Pending".
// A code links to its detail page when the API sent its id; the Route Card has
// no id on the wire, and plan-less (direct) Job Cards carry codes only, so
// those render as plain text.

import { Link } from '@tanstack/react-router';
import {
  ROUTE_CARD_APPROVAL_LABEL,
  type PlanningLine,
  type PlanningPlanSummary,
} from '@innovic/shared';

type RcApproval = PlanningPlanSummary['routeCardApprovalStatus'];

export interface RcRef {
  code: string;
  approval: RcApproval;
}
export interface DocRef {
  code: string;
  /** Detail-page id; null → plain text. */
  id: string | null;
}

/** The plan's Route Card, or none. */
export function planRouteCards(plan: PlanningPlanSummary): RcRef[] {
  return plan.routeCardCode
    ? [{ code: plan.routeCardCode, approval: plan.routeCardApprovalStatus }]
    : [];
}

/** Every live Production Order of the plan, oldest first. An older API build
 *  sends no list — fall back to the single newest PRO it does send. */
export function planPros(plan: PlanningPlanSummary): DocRef[] {
  if (plan.productionOrders.length === 0 && plan.productionOrderCode) {
    return [{ code: plan.productionOrderCode, id: plan.productionOrderId }];
  }
  return plan.productionOrders.map((po) => ({ code: po.code, id: po.id }));
}

/** A Job Card the plan made itself (Execute on an ops-editor plan), not through
 *  a PRO — it was in the old "Linked" cell and must not disappear. */
export function planOwnJc(plan: PlanningPlanSummary): DocRef | null {
  if (!plan.jcCode) return null;
  if (plan.productionOrders.some((po) => po.jcCode === plan.jcCode)) return null;
  return { code: plan.jcCode, id: plan.jcId };
}

/** The Job Card of each PRO, same order (a JC in Trash comes back null →
 *  skipped), then the plan's own Job Card if it has one. */
export function planJcs(plan: PlanningPlanSummary): DocRef[] {
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
export function lineRouteCards(line: PlanningLine): RcRef[] {
  const byCode = new Map<string, RcRef>();
  for (const p of line.plans) {
    for (const rc of planRouteCards(p)) if (!byCode.has(rc.code)) byCode.set(rc.code, rc);
  }
  return [...byCode.values()];
}

export function linePros(line: PlanningLine): DocRef[] {
  return line.plans.flatMap(planPros);
}

/** PRO Job Cards across the line's plans, then the plan-less (direct) ones. */
export function lineJcs(line: PlanningLine): DocRef[] {
  const out: DocRef[] = line.plans.flatMap(planJcs);
  const seen = new Set(out.map((j) => j.code));
  for (const code of line.directJcCodes) {
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({ code, id: null });
  }
  return out;
}

/** The ADR-253 warning beside a card not yet approved; none once approved. */
function rcApprovalLabel(a: RcApproval): string | null {
  return a === 'pending' || a === 'rejected' ? ROUTE_CARD_APPROVAL_LABEL[a] : null;
}

/** Plain text — the cell's tooltip and what Sort & Filter reads. */
export function rcText(rcs: RcRef[]): string {
  if (rcs.length === 0) return 'Pending';
  return rcs
    .map((rc) => [rc.code, rcApprovalLabel(rc.approval)].filter(Boolean).join(' '))
    .join(' · ');
}
export function docText(docs: DocRef[]): string {
  return docs.length === 0 ? 'Pending' : docs.map((d) => d.code).join(' · ');
}

export function PendingText(): JSX.Element {
  return (
    <span className="text3" style={{ fontWeight: 400 }}>
      Pending
    </span>
  );
}

const CODE_STYLE = { color: 'var(--blue)' } as const;

export function DocCode({ doc, kind }: { doc: DocRef; kind: 'pro' | 'jc' }): JSX.Element {
  if (!doc.id) {
    return (
      <span className="mono fw-700" style={CODE_STYLE}>
        {doc.code}
      </span>
    );
  }
  return kind === 'pro' ? (
    <Link
      to="/production-orders/$id"
      params={{ id: doc.id }}
      className="mono fw-700"
      style={CODE_STYLE}
    >
      {doc.code}
    </Link>
  ) : (
    <Link to="/job-cards/$id" params={{ id: doc.id }} className="mono fw-700" style={CODE_STYLE}>
      {doc.code}
    </Link>
  );
}

/** Route Card codes, each with its approval warning when not yet approved. */
export function RcCodes({ rcs }: { rcs: RcRef[] }): JSX.Element {
  if (rcs.length === 0) return <PendingText />;
  return (
    <>
      {rcs.map((rc, i) => {
        const warn = rcApprovalLabel(rc.approval);
        return (
          <span key={rc.code}>
            {i > 0 ? ' · ' : null}
            <span className="mono fw-700" style={{ color: 'var(--text)' }}>
              {rc.code}
            </span>
            {warn ? (
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber)', marginLeft: 4 }}>
                {warn}
              </span>
            ) : null}
          </span>
        );
      })}
    </>
  );
}

/** PRO or JC codes, " · " joined on one line (`stacked` → one per line, for
 *  the ▸ panel where each PRO sits beside its own JC). */
export function DocCodes({
  docs,
  kind,
  stacked = false,
}: {
  docs: DocRef[];
  kind: 'pro' | 'jc';
  stacked?: boolean;
}): JSX.Element {
  if (docs.length === 0) return <PendingText />;
  return (
    <>
      {docs.map((d, i) =>
        stacked ? (
          <div key={`${d.code}-${i}`}>
            <DocCode doc={d} kind={kind} />
          </div>
        ) : (
          <span key={`${d.code}-${i}`}>
            {i > 0 ? ' · ' : null}
            <DocCode doc={d} kind={kind} />
          </span>
        ),
      )}
    </>
  );
}
