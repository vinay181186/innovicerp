// Edit a Multi-Level Plan (ADR-225 phase 3) — Draft only: Plan Qty and
// Remarks. The save carries the version the form opened with; a save over a
// newer edit is refused with 409 and the server's message shows in the banner.

import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { ML_PLAN_STATUS_LABEL } from '@innovic/shared';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { useOpenedVersion } from '@/lib/use-opened-version';
import { useSaveKey } from '@/lib/use-save-key';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Icon } from '@/ui/core';
import { PageState } from '@/ui/layout';
import { useMlPlan, useUpdateMlPlan } from '../api';
import { MlPlanForm, type MlPlanFormDraft, type MlPlanFormLine } from '../components/ml-plan-form';

export const mlPlanEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'ml-plans/$id/edit',
  component: MlPlanEditPage,
});

function MlPlanEditPage(): React.JSX.Element {
  const { id } = mlPlanEditRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useMlPlan(id);
  const saveKey = useSaveKey();
  const update = useUpdateMlPlan(id, saveKey);
  const opened = useOpenedVersion(detail?.updatedAt);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'mlplan_create');
  const goBack = useCallback(
    () => void navigate({ to: '/ml-plans/$id', params: { id } }),
    [navigate, id],
  );
  const exit = useExitConfirm({ onExit: goBack });

  const submit = async (_line: MlPlanFormLine, draft: MlPlanFormDraft): Promise<void> => {
    setSubmitError(null);
    try {
      const updated = await update.mutateAsync({
        planQty: Number(draft.planQty),
        remarks: draft.remarks.trim() ? draft.remarks.trim() : null,
        expectedUpdatedAt: opened.expected(),
      });
      opened.saved(updated.updatedAt);
      exit.leave(
        () => void navigate({ to: '/ml-plans/$id', params: { id: updated.id }, replace: true }),
      );
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Could not save plan. Try again.');
    }
  };

  if (eff && !perms.edit) {
    return <PageState as="page" state="noaccess" />;
  }
  if (isLoading) {
    return <PageState state="loading" message="⟳ Loading plan…" />;
  }
  if (isError || !detail || detail.status !== 'draft') {
    return (
      <div>
        <Link
          to="/ml-plans"
          className="btn btn-ghost btn-sm"
          style={{ marginBottom: 'var(--sp-2)' }}
        >
          <Icon name="arrow-left" size={14} /> Back
        </Link>
        <PageState
          state="error"
          message={
            detail
              ? `${detail.code} is ${ML_PLAN_STATUS_LABEL[detail.status]} — only a Draft plan can be edited.`
              : error instanceof Error
                ? error.message
                : 'Plan not found.'
          }
        />
      </div>
    );
  }

  return (
    <>
      {exit.dialog}
      <MlPlanForm
        mode="edit"
        code={detail.code}
        initialLine={{
          soLineId: detail.soLineId,
          soCode: detail.soCode,
          lineNo: detail.lineNo,
          itemCode: detail.itemCode,
          itemName: detail.itemName,
          orderQty: detail.orderQty,
          mlBomCode: detail.mlBomCode,
        }}
        initial={{ planQty: String(detail.planQty), remarks: detail.remarks ?? '' }}
        onSubmit={submit}
        submitting={update.isPending}
        submitError={submitError}
        onCancel={() => exit.leave(goBack)}
      />
    </>
  );
}
