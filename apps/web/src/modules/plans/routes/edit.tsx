import type { PlanDetail } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { isStagedResult } from '@/modules/document-edits/api';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { useOpenedVersion } from '@/lib/use-opened-version';
import { useSaveKey } from '@/lib/use-save-key';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Banner } from '@/ui/feedback';
import { usePlan, useUpdatePlan } from '../api';
import { PlanForm, type PlanFormValues, toCreateInput } from '../components/plan-form';
import { STORED_LABEL } from '../lib/derived-status';

export const planEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'plans/$id/edit',
  component: PlanEditPage,
});

function PlanEditPage(): React.JSX.Element {
  const { id } = planEditRoute.useParams();
  const navigate = useNavigate();
  const { data: plan, isLoading, isError, error } = usePlan(id);
  const saveKey = useSaveKey();
  const update = useUpdatePlan(id, saveKey);
  // R5 — the version this form opened with; a save over someone else's newer
  // edit is refused (409 edit_conflict) and its message shows in the form.
  const opened = useOpenedVersion(plan?.updatedAt);
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'plan_create');
  // No Cancel button on this screen, so ESC → Exit falls back to history.
  const exit = useExitConfirm();
  // ADR-202 — set when an edit to a LIVE plan is staged for approval instead of
  // applied; the neutral "Sent for approval" banner shows it.
  const [stagedNotice, setStagedNotice] = useState<string | null>(null);
  // ONE stable object per loaded version of the plan. PlanForm resets its
  // values AND its RM "touched" flags whenever this prop's identity changes, so
  // building it inline (`toFormValues(plan)` in the JSX) meant ANY parent
  // re-render — the staged-approval notice, useMyAccess settling, isPending
  // toggling — silently cleared them. A planner who had deliberately cleared RM
  // Grade would then be reported as never having touched it, the pair would be
  // left out of the PATCH, and the server would refill it from the BOM line or
  // Route Card: the exact opposite of what they asked for. Keyed on the
  // version, not on object identity.
  //
  // ADR-226: keyed on the version this form OPENED with, not the live one.
  // `plan?.updatedAt` moves the moment anyone else saves this plan and the
  // query refetches, which re-seeded the form and threw away what the planner
  // was typing — silently, and with no save involved. `opened.expected()` is
  // captured once (lib/use-opened-version.ts) so it seeds the form on first
  // load and never again; a newer version from someone else is answered by the
  // 409 + notice on save instead of by wiping the screen. Our own save calls
  // `opened.saved()`, which is the one legitimate re-seed.
  const openedVersion = opened.expected();
  const initialValues = useMemo(
    () => (plan ? toFormValues(plan) : null),
    [plan?.id, openedVersion],
  );

  if (eff && !perms.edit) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to edit Plans. Ask an admin.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading plan…
      </div>
    );
  }
  if (isError || !plan || !initialValues) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Plan not found.'}
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
            <ArrowLeft size={14} /> Back
          </Link>
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            A {STORED_LABEL[plan.planStatus]} plan cannot be edited.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {exit.dialog}
      <Link
        to="/plans/$id"
        params={{ id: plan.id }}
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 10 }}
      >
        <ArrowLeft size={14} /> Back
      </Link>
      <div className="section-hdr" style={{ marginBottom: 10 }}>
        Edit Plan {plan.code}
      </div>

      {stagedNotice ? (
        <Banner tone="success" role="status">
          {stagedNotice}
        </Banner>
      ) : null}

      <PlanForm
        initialValues={initialValues}
        isEdit
        // ADR-170 — route-card-driven plans carry no operations; the ops
        // editor is hidden and `ops` is left out of the PATCH so the server's
        // replace-all never runs against them.
        hideOps={plan.opsSource === 'route_card'}
        soInternalNo={plan.soInternalNo ?? null}
        isSubmitting={update.isPending}
        submitLabel="Save Changes"
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
              // ADR-218 — RM Grade, RM Size, RM Item and RM Qty per piece are
              // deliberately ABSENT from this PATCH. Server contract
              // (apps/api/src/modules/plans/service.ts, updatePlanTx): a field
              // present in the body — a value OR an explicit null — means "the
              // caller owns this, do not default it", and ONLY an omitted field
              // is filled from the plan's BOM line, else from the item's Route
              // Card. Those two are the only authors of raw material, so this
              // screen sends none of the four.
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
              ...(plan.opsSource === 'route_card' ? {} : { ops: ci.ops }),
              expectedUpdatedAt: opened.expected(),
            },
            {
              onSuccess: (saved) => {
                if (isStagedResult(saved)) {
                  // Edit-approval gate is on and this plan is live: nothing
                  // changed on the plan — the edit is waiting for approval. Say
                  // so, then return to the plan (its fields now carry the
                  // pending-change chip).
                  setStagedNotice(
                    'Sent for approval — your changes will apply once an approver signs off.',
                  );
                  exit.leave(
                    () =>
                      void navigate({ to: '/plans/$id', params: { id: plan.id }, replace: true }),
                  );
                  return;
                }
                opened.saved(saved.updatedAt);
                exit.leave(() => void navigate({ to: '/plans/$id', params: { id: plan.id } }));
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
    // ADR-218 — carried for DISPLAY only; the form neither changes nor sends
    // them, so the master ids are not carried at all.
    rawMaterialGradeText: plan.rawMaterialGradeText,
    rawMaterialSizeText: plan.rawMaterialSizeText,
    rawMaterialItemCode: plan.rawMaterialItemCode,
    rmQtyPerPiece: plan.rmQtyPerPiece != null ? String(plan.rmQtyPerPiece) : '',
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
      // Carried, not edited — see PlanFormValues.ops. Dropping these here blanked
      // a route card's machine / program / tool data on every plan edit.
      machineId: op.machineId,
      machineCodeText: op.machineCodeText ?? '',
      program: op.program ?? '',
      toolNo: op.toolNo ?? '',
      toolDetails: op.toolDetails ?? '',
      outsourceVendorId: op.outsourceVendorId,
      outsourceVendorText: op.outsourceVendorText ?? '',
      outsourceCost: Number(op.outsourceCost),
    })),
  };
}
