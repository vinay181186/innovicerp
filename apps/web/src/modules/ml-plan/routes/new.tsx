// New Multi-Level Plan (ADR-225 phase 3). Optional ?soLineId= (and
// ?salesOrderId=, sent by the SO Planning ⋯) preselects the SO line — only if
// the server lists it as eligible; otherwise the form says it cannot be
// planned this way and the picker stays empty.

import { createRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { useSaveKey } from '@/lib/use-save-key';
import { authenticatedRoute } from '@/routes/_authenticated';
import { PageState } from '@/ui/layout';
import { useCreateMlPlan, useMlPlanEligibleLines } from '../api';
import { MlPlanForm, type MlPlanFormDraft, type MlPlanFormLine } from '../components/ml-plan-form';

const searchSchema = z.object({
  soLineId: z.string().uuid().optional().catch(undefined),
  salesOrderId: z.string().uuid().optional().catch(undefined),
});

export const mlPlanNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'ml-plans/new',
  validateSearch: searchSchema,
  component: MlPlanNewPage,
});

function MlPlanNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { soLineId, salesOrderId } = mlPlanNewRoute.useSearch();
  const saveKey = useSaveKey();
  const create = useCreateMlPlan(saveKey);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'mlplan_create');
  const goBack = useCallback(() => void navigate({ to: '/ml-plans' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });

  // The preselected line, looked up in the server's eligible list (the SO's
  // lines when the SO is known, else the first page).
  const pre = useMlPlanEligibleLines(salesOrderId ? { salesOrderId, limit: 100 } : { limit: 100 }, {
    enabled: Boolean(soLineId),
  });
  const preLine = useMemo<MlPlanFormLine | null>(
    () => (soLineId ? (pre.data?.lines.find((l) => l.soLineId === soLineId) ?? null) : null),
    [soLineId, pre.data],
  );
  const preselectMissing = Boolean(soLineId) && pre.isSuccess && !preLine;

  const submit = async (line: MlPlanFormLine, draft: MlPlanFormDraft): Promise<void> => {
    setSubmitError(null);
    try {
      // ADR-224: no code is sent — the server numbers the plan on save.
      const created = await create.mutateAsync({
        soLineId: line.soLineId,
        planQty: Number(draft.planQty),
        remarks: draft.remarks.trim() ? draft.remarks.trim() : null,
      });
      exit.leave(() => void navigate({ to: '/ml-plans/$id', params: { id: created.id } }));
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Could not save plan. Try again.');
    }
  };

  if (eff && !perms.entry) {
    return <PageState as="page" state="noaccess" />;
  }
  if (soLineId && pre.isLoading) {
    return <PageState state="loading" message="⟳ Loading SO line…" />;
  }

  return (
    <>
      {exit.dialog}
      <MlPlanForm
        mode="create"
        initialLine={preLine}
        preselectMissing={preselectMissing}
        initial={{ planQty: preLine ? String(preLine.orderQty) : '', remarks: '' }}
        onSubmit={submit}
        submitting={create.isPending}
        submitError={submitError}
        onCancel={() => exit.leave(goBack)}
      />
    </>
  );
}
