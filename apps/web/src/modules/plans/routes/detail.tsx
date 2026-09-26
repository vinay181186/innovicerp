// Plan detail (PL-4). Shows full plan + ops + linked entities + actions.

import type { PlanStatus, PlanType } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, CheckCircle, Loader2, Pencil, Play, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { RelatedDocsPanel } from '@/components/shared/related-docs-panel';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { itemCodeWithRev } from '@/lib/item-code';
import { authenticatedRoute } from '@/routes/_authenticated';
import { StatusBadge } from '@/ui/core';
import { useExecutePlan, useFinalizePlan, usePlan, useSoftDeletePlan } from '../api';

export const planDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'plans/$id',
  component: PlanDetailPage,
});

// The plan-status words. The COLOURS live in ui/core/StatusBadge.tsx under
// kind="plan" — one map, shared with the Plans list, so the two screens cannot
// paint the same status differently.
const STATUS_LABEL: Record<PlanStatus, string> = {
  in_planning: 'In Planning',
  planned: 'Planned',
  jc_created: 'JC Created',
  pr_created: 'PR Created',
  in_production: 'In Production',
  complete: 'Completed',
  cancelled: 'Cancelled',
};

const TYPE_LABEL: Record<PlanType, string> = {
  manufacture: '🏭 Manufacture',
  direct_purchase: '🛒 Direct Purchase',
  full_outsource: '📦 Full Outsource',
  assembly: '🔧 Assembly',
};

const OP_TYPE_LABEL: Record<string, string> = {
  process: 'In-house',
  outsource: 'Outsource',
  qc: 'QC',
};

function PlanDetailPage(): React.JSX.Element {
  const { id } = planDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: plan, isLoading, isError, error } = usePlan(id);
  const finalize = useFinalizePlan();
  const execute = useExecutePlan();
  const softDelete = useSoftDeletePlan();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'plan_create');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading plan…
      </div>
    );
  }
  if (isError || !plan) {
    return (
      <div className="panel">
        <div className="panel-body">
          <Link to="/plans" className="btn btn-ghost btn-sm" style={{ marginBottom: 8 }}>
            <ArrowLeft size={14} /> Back
          </Link>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Plan not found.'}
          </div>
        </div>
      </div>
    );
  }

  // Money hidden for L1 Viewers: the API nulls die cost / rate / op outsource
  // cost together, so the OSP cost column and the cost/rate fields are dropped.
  // Told by the server, not inferred from a null money field: a null also means
  // "no value yet", so probing it hid money from users entitled to see it.
  const priceHidden = !plan.priceVisible;
  const isEditable = plan.planStatus === 'in_planning' || plan.planStatus === 'planned';
  // ADR-170 — a route-card-driven plan holds no operations and is never
  // Finalized / Executed here: a Production Order builds its Job Card from the
  // item's Route Card. Old plans (opsSource 'plan') keep every action as before.
  const fromRouteCard = plan.opsSource === 'route_card';
  const canFinalize = !fromRouteCard && plan.planStatus === 'in_planning';
  const canExecute = !fromRouteCard && plan.planStatus === 'planned';

  const onFinalize = (): void => {
    setActionError(null);
    finalize.mutate(plan.id, {
      onError: (e) =>
        setActionError(
          e instanceof Error ? e.message : 'Could not mark the plan Planned. Try again.',
        ),
    });
  };
  const onExecute = (): void => {
    setActionError(null);
    execute.mutate(plan.id, {
      onError: (e) =>
        setActionError(
          e instanceof Error ? e.message : 'Could not create the Job Card / PR. Try again.',
        ),
    });
  };
  const onDelete = (): void => {
    softDelete.mutate(plan.id, {
      onSuccess: () => {
        void navigate({ to: '/plans', replace: true });
      },
      onError: (e) =>
        setActionError(e instanceof Error ? e.message : 'Could not delete Plan. Try again.'),
    });
  };

  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }

  return (
    <div>
      <Link to="/plans" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to plans
      </Link>

      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div
              className="td-code"
              style={{ color: 'var(--cyan)', fontSize: 16, fontWeight: 700 }}
            >
              {plan.code}
            </div>
            <div
              className="panel-title"
              style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 10 }}
            >
              {/* Falls back to the item code only when neither name is known, and
                  when it does it must read `CODE/REV` like everywhere else — the
                  helper drops the slash when the plan has no SO line behind it. */}
              {plan.itemName ??
                plan.itemNameText ??
                itemCodeWithRev(plan.itemCode ?? plan.itemCodeText, plan.itemRevision)}
              <StatusBadge
                kind="plan"
                status={plan.planStatus}
                label={STATUS_LABEL[plan.planStatus]}
              />
              <span className="text3" style={{ fontSize: 12 }}>
                {TYPE_LABEL[plan.planType]}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {perms.edit && canFinalize ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onFinalize}
                disabled={finalize.isPending}
                title="Mark Planned (lock for execution)"
              >
                {finalize.isPending ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <CheckCircle size={13} />
                )}{' '}
                Mark Planned
              </button>
            ) : null}
            {perms.edit && canExecute ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={onExecute}
                disabled={execute.isPending}
                title={
                  plan.planType === 'manufacture' || plan.planType === 'assembly'
                    ? 'Create the Job Card and copy the operations'
                    : 'Raise the PR(s)'
                }
              >
                {execute.isPending ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Play size={13} />
                )}{' '}
                {plan.planType === 'manufacture' || plan.planType === 'assembly'
                  ? 'Create Job Card'
                  : 'Raise PR'}
              </button>
            ) : null}
            {perms.edit && isEditable ? (
              <Link to="/plans/$id/edit" params={{ id: plan.id }} className="btn btn-ghost btn-sm">
                <Pencil size={13} /> Edit
              </Link>
            ) : null}
            {perms.edit && perms.approve && isEditable ? (
              confirmDelete ? (
                <>
                  <span className="text3" style={{ fontSize: 12, alignSelf: 'center' }}>
                    Delete?
                  </span>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={onDelete}
                    disabled={softDelete.isPending}
                  >
                    {softDelete.isPending ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Trash2 size={13} />
                    )}{' '}
                    Confirm
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setConfirmDelete(false)}
                    disabled={softDelete.isPending}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={13} /> Delete
                </button>
              )
            ) : null}
          </div>
        </div>
        <div className="panel-body">
          {actionError ? (
            <div
              style={{
                color: 'var(--red)',
                background: 'var(--red3)',
                border: '1px solid #fca5a5',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 12,
                marginBottom: 10,
              }}
            >
              {actionError}
            </div>
          ) : null}

          <Grid>
            <KV label="Plan Date" value={plan.planDate} />
            <KV label="Order Qty" value={plan.orderQty} />
            <KV label="Plan Qty" value={plan.planQty} />
            <KV label="Planned Start Date" value={plan.plannedStartDate ?? '—'} />
            <KV label="Planned End Date" value={plan.plannedEndDate ?? '—'} />
            <KV label="Customer Dispatch Date" value={plan.customerDispatchDate ?? '—'} />
            {/* Raw material — read-only here; both are optional, so a plan with
                neither still shows the pair as dashes rather than hiding them
                (a missing grade is a planning gap worth seeing). */}
            <KV label="RM Grade" value={plan.rawMaterialGradeText ?? '—'} />
            <KV label="RM Size" value={plan.rawMaterialSizeText ?? '—'} />
            {/* `CODE/REV` — the customer's drawing revision from the SO line this
                plan was raised against; a JW-sourced or ad-hoc plan has none and
                keeps the bare code, with no trailing slash. */}
            <KV
              label="Item Code"
              value={itemCodeWithRev(plan.itemCode ?? plan.itemCodeText, plan.itemRevision)}
            />
            {/* POL — the line number printed on the CUSTOMER's own purchase
                order. It is NOT our SO line number ("Line #" below); on live
                data our line 11 is the customer's line 20. Both are shown. */}
            <KV
              label="POL"
              value={
                <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
                  {plan.clientPoLineNo ?? '—'}
                </span>
              }
            />
            <KV label="SO No." value={plan.soCodeText ?? '—'} />
            <KV label="Ln" value={plan.lineNo ?? '—'} />
          </Grid>

          {plan.planType === 'direct_purchase' ? (
            <>
              <div className="section-hdr" style={{ marginTop: 14 }}>
                Direct purchase
              </div>
              <Grid>
                <KV label="Vendor" value={plan.dpVendorCodeText ?? '—'} />
                {priceHidden ? null : <KV label="Cost" value={plan.dpCost ?? '—'} />}
                <KV label="PR" value={plan.dpPrId ? '✓ Created' : '—'} />
                {plan.dpRemarks ? <KV label="Remarks" value={plan.dpRemarks} /> : null}
              </Grid>
            </>
          ) : null}

          {plan.planType === 'full_outsource' ? (
            <>
              <div className="section-hdr" style={{ marginTop: 14 }}>
                Full outsource
              </div>
              <Grid>
                <KV label="JW Vendor" value={plan.foVendorCodeText ?? '—'} />
                <KV label="Process" value={plan.foProcess ?? '—'} />
                {priceHidden ? null : <KV label="Rate" value={plan.foRate ?? '—'} />}
                <KV label="Material Source" value={plan.foMaterialSrc ?? '—'} />
                <KV label="Delivery Date" value={plan.foDeliveryDate ?? '—'} />
                <KV label="Cost Centre" value={plan.foCostCenter ?? '—'} />
                <KV label="JW PR" value={plan.foPrId ? '✓ Created' : '—'} />
                <KV label="Material PR" value={plan.foMatPrId ? '✓ Created' : '—'} />
                {plan.foRemarks ? <KV label="Remarks" value={plan.foRemarks} /> : null}
              </Grid>
            </>
          ) : null}

          {(plan.planType === 'manufacture' || plan.planType === 'assembly') && plan.jcId ? (
            <Grid>
              <KV label="Job Card" value="✓ Created" />
            </Grid>
          ) : null}

          {fromRouteCard ? (
            <div
              className="text3"
              style={{
                marginTop: 12,
                padding: '8px 10px',
                border: '1px solid var(--border)',
                borderRadius: 6,
                background: 'var(--bg2)',
                fontSize: 12,
              }}
            >
              Operations come from the item's Route Card. Create a Production Order to build the Job
              Card.{' '}
              {perms.entry && plan.planStatus === 'planned' && !plan.jcId ? (
                <Link to="/production-orders/new" style={{ color: 'var(--cyan)', fontWeight: 600 }}>
                  Create Production Order →
                </Link>
              ) : null}
            </div>
          ) : null}

          {plan.remarks ? (
            <div style={{ marginTop: 12 }}>
              <div
                className="text3"
                style={{
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 4,
                }}
              >
                Remarks
              </div>
              <div style={{ fontSize: 13 }}>{plan.remarks}</div>
            </div>
          ) : null}
        </div>
      </div>

      {!fromRouteCard && plan.ops.length > 0 ? (
        <div className="panel">
          <div className="panel-hdr">
            <div className="panel-title">Operations ({plan.ops.length})</div>
          </div>
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Op</th>
                  <th>Operation</th>
                  <th>Op Type</th>
                  <th>Planned Machine</th>
                  <th>Cycle Time (min)</th>
                  <th>QC Required</th>
                  <th>OSP Vendor</th>
                  {priceHidden ? null : <th>OSP Cost</th>}
                </tr>
              </thead>
              <tbody>
                {plan.ops.map((op) => (
                  <tr key={op.id}>
                    {/* 10, 20, 30 on screen — display rule, see opSrNo */}
                    <td>{opSrNo(op.opSeq)}</td>
                    <td>{op.operation}</td>
                    <td>{OP_TYPE_LABEL[op.opType] ?? op.opType}</td>
                    <td>{op.machineCodeText ?? '—'}</td>
                    <td>{op.cycleTimeMin}</td>
                    <td>{op.qcRequired ? '✓' : ''}</td>
                    <td>{op.outsourceVendorText ?? '—'}</td>
                    {priceHidden ? null : <td>{op.outsourceCost}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <RelatedDocsPanel module="plans" id={plan.id} />
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 10,
      }}
    >
      {children}
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <div
        className="text3"
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{value}</div>
    </div>
  );
}
