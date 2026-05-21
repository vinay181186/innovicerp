// Plan detail (PL-4). Shows full plan + ops + linked entities + actions.

import type { PlanStatus, PlanType } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, CheckCircle, Loader2, Pencil, Play, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import {
  useExecutePlan,
  useFinalizePlan,
  usePlan,
  useSoftDeletePlan,
} from '../api';

export const planDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'plans/$id',
  component: PlanDetailPage,
});

const STATUS_BADGE: Record<PlanStatus, { cls: string; label: string }> = {
  in_planning: { cls: 'b-grey', label: 'In Planning' },
  planned: { cls: 'b-blue', label: 'Planned' },
  jc_created: { cls: 'b-cyan', label: 'JC Created' },
  pr_created: { cls: 'b-cyan', label: 'PR Created' },
  in_production: { cls: 'b-amber', label: 'In Production' },
  complete: { cls: 'b-green', label: 'Complete' },
  cancelled: { cls: 'b-grey', label: 'Cancelled' },
};

const TYPE_LABEL: Record<PlanType, string> = {
  manufacture: '🏭 Manufacture',
  direct_purchase: '🛒 Direct Purchase',
  full_outsource: '📦 Full Outsource',
  assembly: '🔧 Assembly',
};

function PlanDetailPage(): React.JSX.Element {
  const { id } = planDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: plan, isLoading, isError, error } = usePlan(id);
  const finalize = useFinalizePlan();
  const execute = useExecutePlan();
  const softDelete = useSoftDeletePlan();
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
          <Link to="/planning-dashboard" className="btn btn-ghost btn-sm" style={{ marginBottom: 8 }}>
            <ArrowLeft size={14} /> Back
          </Link>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Plan not found'}
          </div>
        </div>
      </div>
    );
  }

  const isEditable = plan.planStatus === 'in_planning' || plan.planStatus === 'planned';
  const canFinalize = plan.planStatus === 'in_planning';
  const canExecute = plan.planStatus === 'planned';

  const onFinalize = (): void => {
    setActionError(null);
    finalize.mutate(plan.id, {
      onError: (e) => setActionError(e instanceof Error ? e.message : 'Finalize failed'),
    });
  };
  const onExecute = (): void => {
    setActionError(null);
    execute.mutate(plan.id, {
      onError: (e) => setActionError(e instanceof Error ? e.message : 'Execute failed'),
    });
  };
  const onDelete = (): void => {
    softDelete.mutate(plan.id, {
      onSuccess: () => {
        void navigate({ to: '/planning-dashboard', replace: true });
      },
      onError: (e) => setActionError(e instanceof Error ? e.message : 'Delete failed'),
    });
  };

  const status = STATUS_BADGE[plan.planStatus];

  return (
    <div>
      <Link to="/planning-dashboard" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to dashboard
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
              {plan.itemName ?? plan.itemNameText ?? plan.itemCode ?? plan.itemCodeText ?? '—'}
              <span className={`badge ${status.cls}`}>{status.label}</span>
              <span className="text3" style={{ fontSize: 12 }}>
                {TYPE_LABEL[plan.planType]}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {canFinalize ? (
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
                Finalize
              </button>
            ) : null}
            {canExecute ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={onExecute}
                disabled={execute.isPending}
                title={
                  plan.planType === 'manufacture' || plan.planType === 'assembly'
                    ? 'Create JC + copy ops'
                    : 'Create PR(s)'
                }
              >
                {execute.isPending ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Play size={13} />
                )}{' '}
                Execute
              </button>
            ) : null}
            {isEditable ? (
              <Link
                to="/plans/$id/edit"
                params={{ id: plan.id }}
                className="btn btn-ghost btn-sm"
              >
                <Pencil size={13} /> Edit
              </Link>
            ) : null}
            {isEditable ? (
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
            <KV label="Plan date" value={plan.planDate} />
            <KV label="Order qty" value={plan.orderQty} />
            <KV label="Plan qty" value={plan.planQty} />
            <KV label="Planned start" value={plan.plannedStartDate ?? '—'} />
            <KV label="Planned end" value={plan.plannedEndDate ?? '—'} />
            <KV label="Item code" value={plan.itemCode ?? plan.itemCodeText ?? '—'} />
            <KV label="SO ref" value={plan.soCodeText ?? '—'} />
            <KV label="Line #" value={plan.lineNo ?? '—'} />
          </Grid>

          {plan.planType === 'direct_purchase' ? (
            <>
              <div className="section-hdr" style={{ marginTop: 14 }}>
                Direct purchase
              </div>
              <Grid>
                <KV label="Vendor" value={plan.dpVendorCodeText ?? '—'} />
                <KV label="Cost" value={plan.dpCost ?? '—'} />
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
                <KV label="JW vendor" value={plan.foVendorCodeText ?? '—'} />
                <KV label="Process" value={plan.foProcess ?? '—'} />
                <KV label="Rate" value={plan.foRate ?? '—'} />
                <KV label="Material src" value={plan.foMaterialSrc ?? '—'} />
                <KV label="Delivery" value={plan.foDeliveryDate ?? '—'} />
                <KV label="Cost centre" value={plan.foCostCenter ?? '—'} />
                <KV label="JW PR" value={plan.foPrId ? '✓ Created' : '—'} />
                <KV label="Mat PR" value={plan.foMatPrId ? '✓ Created' : '—'} />
                {plan.foRemarks ? <KV label="Remarks" value={plan.foRemarks} /> : null}
              </Grid>
            </>
          ) : null}

          {(plan.planType === 'manufacture' || plan.planType === 'assembly') &&
          plan.jcId ? (
            <Grid>
              <KV label="Linked JC" value="✓ Created" />
            </Grid>
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

      {plan.ops.length > 0 ? (
        <div className="panel">
          <div className="panel-hdr">
            <div className="panel-title">Operations ({plan.ops.length})</div>
          </div>
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Operation</th>
                  <th>Type</th>
                  <th>Machine</th>
                  <th className="td-right">Cycle (hrs)</th>
                  <th className="td-ctr">QC?</th>
                  <th>OSP vendor</th>
                  <th className="td-right">OSP cost</th>
                </tr>
              </thead>
              <tbody>
                {plan.ops.map((op) => (
                  <tr key={op.id}>
                    <td>{op.opSeq}</td>
                    <td>{op.operation}</td>
                    <td>{op.opType}</td>
                    <td>{op.machineCodeText ?? '—'}</td>
                    <td className="td-right">{op.cycleTimeMin}</td>
                    <td className="td-ctr">{op.qcRequired ? '✓' : ''}</td>
                    <td>{op.outsourceVendorText ?? '—'}</td>
                    <td className="td-right">{op.outsourceCost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
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
