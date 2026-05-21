import type { PlanDetail } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { usePlan, useUpdatePlan } from '../api';
import { PlanForm, type PlanFormValues, toCreateInput } from '../components/plan-form';

export const planEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'plans/$id/edit',
  component: PlanEditPage,
});

function PlanEditPage(): React.JSX.Element {
  const { id } = planEditRoute.useParams();
  const navigate = useNavigate();
  const { data: plan, isLoading, isError, error } = usePlan(id);
  const update = useUpdatePlan(id);

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
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Plan not found'}
          </div>
        </div>
      </div>
    );
  }

  if (plan.planStatus !== 'in_planning' && plan.planStatus !== 'planned') {
    return (
      <div className="panel">
        <div className="panel-body">
          <Link
            to="/plans/$id"
            params={{ id: plan.id }}
            className="btn btn-ghost btn-sm"
            style={{ marginBottom: 10 }}
          >
            <ArrowLeft size={14} /> Back to detail
          </Link>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            Plans in status <b>{plan.planStatus}</b> are read-only. Cancel via the workflow if you
            need changes.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link
        to="/plans/$id"
        params={{ id: plan.id }}
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 10 }}
      >
        <ArrowLeft size={14} /> Back to {plan.code}
      </Link>
      <div className="section-hdr" style={{ marginBottom: 10 }}>
        ✏️ Edit plan {plan.code}
      </div>

      <PlanForm
        initialValues={toFormValues(plan)}
        isEdit
        isSubmitting={update.isPending}
        submitLabel="Save changes"
        submitError={update.error instanceof Error ? update.error.message : null}
        onSubmit={(v) => {
          const ci = toCreateInput(v);
          update.mutate(
            {
              planDate: ci.planDate,
              planType: ci.planType,
              orderQty: ci.orderQty,
              planQty: ci.planQty,
              plannedStartDate: ci.plannedStartDate,
              plannedEndDate: ci.plannedEndDate,
              dpVendorId: ci.dpVendorId,
              dpVendorCodeText: ci.dpVendorCodeText,
              dpCost: ci.dpCost,
              dpRemarks: ci.dpRemarks,
              foVendorId: ci.foVendorId,
              foVendorCodeText: ci.foVendorCodeText,
              foProcess: ci.foProcess,
              foRate: ci.foRate,
              foMaterialSrc: ci.foMaterialSrc,
              foDeliveryDate: ci.foDeliveryDate,
              foCostCenter: ci.foCostCenter,
              foRemarks: ci.foRemarks,
              remarks: ci.remarks,
              ops: ci.ops,
            },
            {
              onSuccess: () => {
                void navigate({ to: '/plans/$id', params: { id: plan.id } });
              },
            },
          );
        }}
      />
    </div>
  );
}

function toFormValues(plan: PlanDetail): PlanFormValues {
  return {
    code: plan.code,
    planDate: plan.planDate,
    planType: plan.planType,
    soLineId: plan.soLineId,
    soCodeText: plan.soCodeText ?? '',
    lineNo: plan.lineNo,
    itemId: plan.itemId,
    itemCodeText: plan.itemCodeText ?? plan.itemCode ?? '',
    itemNameText: plan.itemNameText ?? plan.itemName ?? '',
    orderQty: plan.orderQty,
    planQty: plan.planQty,
    plannedStartDate: plan.plannedStartDate ?? '',
    plannedEndDate: plan.plannedEndDate ?? '',
    bomMasterId: plan.bomMasterId,
    bomParentCode: plan.bomParentCode ?? '',
    bomChildCode: plan.bomChildCode ?? '',
    dpVendorId: plan.dpVendorId,
    dpVendorCodeText: plan.dpVendorCodeText ?? '',
    dpCost: plan.dpCost === null ? null : Number(plan.dpCost),
    dpRemarks: plan.dpRemarks ?? '',
    foVendorId: plan.foVendorId,
    foVendorCodeText: plan.foVendorCodeText ?? '',
    foProcess: plan.foProcess ?? '',
    foRate: plan.foRate === null ? null : Number(plan.foRate),
    foMaterialSrc: plan.foMaterialSrc ?? '',
    foDeliveryDate: plan.foDeliveryDate ?? '',
    foCostCenter: plan.foCostCenter ?? '',
    foRemarks: plan.foRemarks ?? '',
    remarks: plan.remarks ?? '',
    ops: plan.ops.map((op) => ({
      opSeq: op.opSeq,
      operation: op.operation,
      opType: op.opType,
      cycleTimeMin: Number(op.cycleTimeMin),
      qcRequired: op.qcRequired,
      machineCodeText: op.machineCodeText ?? '',
      outsourceVendorText: op.outsourceVendorText ?? '',
      outsourceCost: Number(op.outsourceCost),
      outsourceLeadDays: op.outsourceLeadDays,
    })),
  };
}
