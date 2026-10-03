// The chips shown under a Planning line's ▸ detail panel (PL-4b): one PR chip
// per purchase request (ADR-171) and one plan chip per plan. Split out of
// routes/workflow.tsx (ADR-199 table standard) so the detail view stays under
// the 400-line rule.
//
// ADR-199 level-2 conversion: these chips are now READ-ONLY. Every action they
// used to carry as a button (Edit plan, ⚡ Create JC / Raise PR, + Production
// Order, View JC) lives in the row's ONE ⋯ menu (planning-line-menu.ts), so a
// line's actions are in a single place instead of inside a chip in a cell. What
// stays here is what the planner READS: the plan's code, type, qty, ops count,
// vendor, status, and real links to the documents it produced.

import {
  PLAN_DERIVED_STATUS_LABEL,
  type PlanDerivedStatus,
  type PlanStatus,
  type PlanningLine,
  type PlanningPlanSummary,
  type PrStatus,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Activity } from 'lucide-react';
import { fmtDate } from '@/lib/date';

// Legacy renders the raw stored status text (`esc(plan.status)`), which in the
// legacy store is Title Case ("In Planning", "JC Created", …). Our enum is
// snake_case, so map back to the legacy label. Same {status → label} shape the
// plans module already uses (routes/list.tsx, detail.tsx, dashboard.tsx).
const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  in_planning: 'In Planning',
  planned: 'Planned',
  jc_created: 'JC Created',
  pr_created: 'PR Created',
  in_production: 'In Production',
  complete: 'Completed',
  cancelled: 'Cancelled',
};

const PLAN_STATUS_COLOR: Record<PlanStatus, string> = {
  // Same colour per state as <StatusBadge kind="plan"> (wave 2).
  in_planning: 'var(--text3)',
  planned: 'var(--blue)',
  jc_created: 'var(--cyan)',
  pr_created: 'var(--cyan)',
  in_production: 'var(--amber)',
  complete: 'var(--green)',
  cancelled: 'var(--text3)',
};

const DERIVED_STATUS_COLOR: Record<PlanDerivedStatus, string> = {
  route_card_pending: 'var(--text3)',
  gen_production_order: 'var(--blue)',
  in_production: 'var(--amber)',
  production_complete: 'var(--green)',
};

// ADR-171: a purchase request raised from a BUY line, chip label + colour.
const PR_STATUS_LABEL: Record<PrStatus, string> = {
  open: 'Open',
  approved: 'Approved',
  po_created: 'PO Created',
  cancelled: 'Cancelled',
};
const PR_STATUS_COLOR: Record<PrStatus, string> = {
  open: 'var(--amber)',
  approved: 'var(--blue)',
  po_created: 'var(--green)',
  cancelled: 'var(--text3)',
};

/** One plan's status as it reads on screen: the derived label for a route-card
 *  plan (ADR-170), the plan's own status otherwise. ONE helper, so the Plans
 *  COLUMN and the plan chip in the ▸ panel can never show a plan differently. */
export function planStatusOf(plan: PlanningPlanSummary): { label: string; color: string } {
  const isRouteCard = plan.opsSource === 'route_card';
  return isRouteCard && plan.derivedStatus
    ? {
        label: PLAN_DERIVED_STATUS_LABEL[plan.derivedStatus],
        color: DERIVED_STATUS_COLOR[plan.derivedStatus],
      }
    : { label: PLAN_STATUS_LABEL[plan.planStatus], color: PLAN_STATUS_COLOR[plan.planStatus] };
}

/** One purchase request's status as it reads on screen — the PO number once one
 *  has been raised from it, which is what the PR chip shows in its place. */
export function prStatusOf(pr: PlanningLine['prs'][number]): { label: string; color: string } {
  return {
    label: pr.status === 'po_created' && pr.poCode ? `PO ${pr.poCode}` : PR_STATUS_LABEL[pr.status],
    color: PR_STATUS_COLOR[pr.status],
  };
}

// ─── PR chip (ADR-171) ───────────────────────────────────────────────────

/** One purchase request raised from a BUY line: 🛒 code (link to the PR) ·
 *  qty · status — the PO code once one is raised from it. */
export function PrChip({ pr }: { pr: PlanningLine['prs'][number] }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
        padding: '3px 8px',
        margin: '2px 0',
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        fontSize: 11,
      }}
    >
      <span>🛒</span>
      <Link
        to="/purchase-requests/$id"
        params={{ id: pr.id }}
        className="mono fw-700"
        style={{ color: 'var(--text)' }}
        title="Open the purchase request"
      >
        {pr.code}
      </Link>
      <span className="text2">
        PR · <b>{pr.qty} pcs</b>
      </span>
      <span style={{ fontWeight: 700, color: PR_STATUS_COLOR[pr.status], fontSize: 11 }}>
        {pr.status === 'po_created' && pr.poCode ? (
          <>
            PO <span className="mono">{pr.poCode}</span>
          </>
        ) : (
          PR_STATUS_LABEL[pr.status]
        )}
      </span>
    </div>
  );
}

// ─── Plan chip ───────────────────────────────────────────────────────────

/** A generated PR number, clickable to its detail page when the id is known
 *  (mirrors how a JC number links to /job-cards/$id). Falls back to plain text. */
function PrLink({
  id,
  code,
  color,
}: {
  id: string | null;
  code: string;
  color: string;
}): React.JSX.Element {
  if (!id) return <>{code}</>;
  return (
    <Link
      to="/purchase-requests/$id"
      params={{ id }}
      className="td-code"
      style={{ color }}
      onClick={(e) => e.stopPropagation()}
    >
      {code}
    </Link>
  );
}

/** One plan inside a line's ▸ panel: code · type · qty · ops · vendor · status,
 *  then links to whatever it has produced — the Production Order (route-card
 *  plans, ADR-170), the purchase requests, the Job Card. Read-only: the plan's
 *  ACTIONS are in the row's ⋯ menu. */
export function PlanChip({ plan }: { plan: PlanningPlanSummary }): JSX.Element {
  const isDP = plan.planType === 'direct_purchase';
  const isFO = plan.planType === 'full_outsource';
  const typeIcon = isDP ? '🛒' : isFO ? '📦' : '🏭';
  const typeLabel = isDP ? 'Buy' : isFO ? 'OSP' : 'Make';
  const isRouteCard = plan.opsSource === 'route_card';
  const { label: statusLabel, color: stColor } = planStatusOf(plan);
  // Schedule / raw material / remark ride along as a tooltip so the chip stays
  // one line; the Plans page shows them in full.
  const tip = [
    plan.plannedStartDate ? `Start: ${fmtDate(plan.plannedStartDate)}` : null,
    plan.plannedEndDate ? `End: ${fmtDate(plan.plannedEndDate)}` : null,
    plan.rawMaterialGradeText ? `Grade: ${plan.rawMaterialGradeText}` : null,
    plan.rawMaterialSizeText ? `Size: ${plan.rawMaterialSizeText}` : null,
    plan.remarks ? `Remarks: ${plan.remarks}` : null,
  ]
    .filter((s): s is string => s !== null)
    .join('\n');

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
        padding: '3px 8px',
        margin: '2px 0',
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        fontSize: 11,
      }}
      title={tip || undefined}
    >
      <span>{typeIcon}</span>
      <span className="mono fw-700" style={{ color: 'var(--text)' }}>
        {plan.code}
      </span>
      <span className="text2">
        {typeLabel} · <b>{plan.planQty} pcs</b>
      </span>
      {!isRouteCard && !isDP && !isFO && plan.opsCount > 0 ? (
        <span className="text3" style={{ fontSize: 11 }}>
          ({plan.opsCount} ops{plan.hasOutsourceOp ? ', 🏭 outsrc' : ''})
        </span>
      ) : null}
      {isFO && plan.foVendorCodeText ? (
        <span style={{ fontSize: 11, color: 'var(--purple)' }}>→ {plan.foVendorCodeText}</span>
      ) : null}
      <span style={{ fontWeight: 700, color: stColor, fontSize: 11 }}>{statusLabel}</span>

      {/* Route-card plan: the Production Order (once raised) is the way on. */}
      {isRouteCard && plan.productionOrderId && plan.productionOrderCode ? (
        <Link
          to="/production-orders/$id"
          params={{ id: plan.productionOrderId }}
          className="mono fw-700"
          style={{ fontSize: 11, color: 'var(--blue)' }}
          title="Open the Production Order"
        >
          {plan.productionOrderCode}
        </Link>
      ) : null}

      {/* The code, not the id, decides whether a PR is shown: a soft-deleted PR
          comes back with a null code while the id survives, and PrLink would
          then render an empty link after the literal "PR:" (ADR-209). */}
      {plan.planStatus === 'pr_created' && (plan.foPrCode ?? plan.dpPrCode) ? (
        <span className="mono" style={{ color: 'var(--purple)', fontSize: 11, fontWeight: 700 }}>
          PR:
          <PrLink
            id={plan.foPrId ?? plan.dpPrId}
            code={plan.foPrCode ?? plan.dpPrCode ?? ''}
            color="var(--purple)"
          />
          {plan.foMatPrCode ? (
            <span style={{ color: 'var(--amber2)', marginLeft: 4 }}>
              Material:
              <PrLink id={plan.foMatPrId} code={plan.foMatPrCode} color="var(--amber)" />
            </span>
          ) : null}
        </span>
      ) : null}
      {plan.ospPrs.length > 0 ? (
        <span
          className="mono"
          style={{
            color: 'var(--purple)',
            fontSize: 11,
            fontWeight: 700,
            display: 'inline-flex',
            gap: 3,
            alignItems: 'center',
          }}
          title="OSP purchase request(s) auto-raised for this plan's outsource op(s)"
        >
          PR:
          {plan.ospPrs.map((pr, i) => (
            <span key={pr.id}>
              <PrLink id={pr.id} code={pr.code} color="var(--purple)" />
              {i < plan.ospPrs.length - 1 ? ',' : ''}
            </span>
          ))}
        </span>
      ) : null}
      {/* The Job Card this plan produced — a real link now (ctrl-click / new
          tab), same condition as the button it replaces. The ⋯ menu carries
          the same jump for the planner working down the rows. */}
      {plan.jcId &&
      (plan.planStatus === 'jc_created' ||
        plan.planStatus === 'in_production' ||
        plan.planStatus === 'complete' ||
        isRouteCard) ? (
        <Link
          to="/job-cards/$id"
          params={{ id: plan.jcId }}
          className="mono fw-700"
          style={{ fontSize: 11, color: 'var(--cyan)' }}
          title="Open the Job Card"
        >
          <Activity size={11} /> {plan.jcCode ?? 'View JC'}
        </Link>
      ) : null}
    </div>
  );
}
