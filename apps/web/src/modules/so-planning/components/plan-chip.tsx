// The chips shown inside a Planning line's "Plans" cell (PL-4b): one PR chip
// per purchase request (ADR-171) and one plan chip per plan. Split out of
// routes/workflow.tsx (ADR-199 table standard) so the detail view stays under
// the 400-line rule — the behaviour is unchanged.

import {
  PLAN_DERIVED_STATUS_LABEL,
  type PlanDerivedStatus,
  type PlanStatus,
  type PlanningLine,
  type PlanningPlanSummary,
  type PrStatus,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Activity, Loader2 } from 'lucide-react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
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

/** One plan inside a line's Plans cell: code · type · qty · status, then the
 *  actions that apply.
 *   - opsSource 'plan' (old flow): Edit while in_planning; Execute + Edit
 *     while planned; PR links once raised; View JC once a JC exists.
 *   - opsSource 'route_card' (ADR-170): NO Edit / Execute. The derived status
 *     label, and a link to the Production Order once one exists. */
export function PlanChip({
  plan,
  canEdit,
  onEdit,
  onExecute,
  onViewJc,
  isExecuting = false,
  executeError = null,
}: {
  plan: PlanningPlanSummary;
  canEdit: boolean;
  onEdit: () => void;
  onExecute: () => void | Promise<void>;
  onViewJc: () => void;
  isExecuting?: boolean;
  executeError?: string | null;
}): JSX.Element {
  const isDP = plan.planType === 'direct_purchase';
  const isFO = plan.planType === 'full_outsource';
  const typeIcon = isDP ? '🛒' : isFO ? '📦' : '🏭';
  const typeLabel = isDP ? 'Buy' : isFO ? 'OSP' : 'Make';
  const isRouteCard = plan.opsSource === 'route_card';
  // Raising a Production Order is its own permission (prodorder_create), not
  // this page's plan_create — the same gate the Plans list uses.
  const { data: eff } = useMyAccess();
  const canProductionOrder = effectiveFormPerms(eff, 'prodorder_create').entry;
  const statusLabel =
    isRouteCard && plan.derivedStatus
      ? PLAN_DERIVED_STATUS_LABEL[plan.derivedStatus]
      : PLAN_STATUS_LABEL[plan.planStatus];
  const stColor =
    isRouteCard && plan.derivedStatus
      ? DERIVED_STATUS_COLOR[plan.derivedStatus]
      : PLAN_STATUS_COLOR[plan.planStatus];
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

      {/* Route-card plan ready for its Production Order (ADR-185 derived
          status 'gen_production_order' = "RC Created"): the next step, same
          link + gate as the Plans list's Action column. */}
      {isRouteCard && plan.derivedStatus === 'gen_production_order' && canProductionOrder ? (
        <Link
          to="/production-orders/new"
          search={{ planId: plan.id, planCode: plan.code }}
          className="btn btn-primary btn-sm"
          style={{ fontSize: 11 }}
          title="Raise the Production Order for this plan"
        >
          + Production Order
        </Link>
      ) : null}

      {/* Old-flow plan actions — unchanged behaviour, compact buttons. */}
      {!isRouteCard && plan.planStatus === 'in_planning' && canEdit ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ fontSize: 11, color: 'var(--amber2)', fontWeight: 700 }}
          onClick={onEdit}
        >
          ✏ Edit
        </button>
      ) : null}
      {!isRouteCard && plan.planStatus === 'planned' && canEdit ? (
        <>
          <button
            type="button"
            className={`btn btn-sm ${executeError ? 'btn-danger' : 'btn-success'}`}
            style={{ fontSize: 11, fontWeight: 700, opacity: isExecuting ? 0.7 : 1 }}
            disabled={isExecuting}
            title={executeError ?? undefined}
            onClick={onExecute}
          >
            {isExecuting ? (
              <>
                <Loader2 size={11} className="inline-block animate-spin" /> Creating…
              </>
            ) : executeError ? (
              '⚠ Retry'
            ) : isDP || isFO ? (
              '⚡ Raise PR'
            ) : (
              '⚡ Create JC'
            )}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11 }}
            disabled={isExecuting}
            onClick={onEdit}
            title="Edit plan"
          >
            ✏
          </button>
        </>
      ) : null}
      {plan.planStatus === 'pr_created' ? (
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
      {plan.jcId &&
      (plan.planStatus === 'jc_created' ||
        plan.planStatus === 'in_production' ||
        plan.planStatus === 'complete' ||
        isRouteCard) ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ fontSize: 11, color: 'var(--cyan)' }}
          onClick={onViewJc}
          title="Open the Job Card"
        >
          <Activity size={11} /> {plan.jcCode ?? 'View JC'}
        </button>
      ) : null}
    </div>
  );
}
