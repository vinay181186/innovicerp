import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ROUTE_CARD_LOCKED_MESSAGE, canEditRouteCard, isRouteCardLocked } from '@innovic/shared';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { useSession } from '@/lib/session';
import { useOpenedVersion } from '@/lib/use-opened-version';
import { useSaveKey } from '@/lib/use-save-key';
import { isStagedResult } from '@/modules/document-edits/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useToast } from '@/ui/feedback';
import { useRouteCard, useUpdateRouteCard } from '../api';
import { rcSavedMessage } from '../components/rc-approval-actions';
import {
  RouteCardForm,
  type RouteCardFormHeaderDraft,
  drawingToInput,
  type RouteCardFormOpDraft,
  detailOpsToDrafts,
  opsToInput,
  rawMaterialToInput,
} from '../components/route-card-form';

export const routeCardEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'route-cards/$id/edit',
  component: RouteCardEditPage,
});

function RouteCardEditPage(): React.JSX.Element {
  const { id } = routeCardEditRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useRouteCard(id);
  const saveKey = useSaveKey();
  const update = useUpdateRouteCard(id, saveKey);
  // R5 — the version this form opened with; a save over someone else's newer
  // edit is refused (409 edit_conflict) and its message shows in the banner.
  const opened = useOpenedVersion(detail?.updatedAt);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { data: eff, isPending: effPending } = useMyAccess();
  const { data: me, isPending: mePending } = useSession();
  // ADR-277 — these checks decide whether the form OPENS. If the card is sent
  // while the form is open, a live refresh must not wipe what is typed: the form
  // stays and its Save gets the server's refusal.
  const formOpened = useRef(false);
  const perms = effectiveFormPerms(eff, 'routecard_create');
  const toast = useToast();
  const goBack = useCallback(
    () => void navigate({ to: '/route-cards/$id', params: { id } }),
    [navigate, id],
  );
  const exit = useExitConfirm({ onExit: goBack });

  const initialOps = useMemo<RouteCardFormOpDraft[]>(
    () => detailOpsToDrafts(detail?.ops ?? []),
    [detail],
  );

  const submit = async (
    header: RouteCardFormHeaderDraft,
    ops: RouteCardFormOpDraft[],
    revisionNote: string | null,
    submitForApproval: boolean,
  ): Promise<void> => {
    setSubmitError(null);
    try {
      const updated = await update.mutateAsync({
        code: header.code.trim(),
        itemId: header.itemId,
        ...drawingToInput(header),
        ...rawMaterialToInput(header),
        notes: header.notes.trim() || null,
        planType: header.planType,
        ops: opsToInput(ops),
        revisionNote,
        submitForApproval,
        expectedUpdatedAt: opened.expected(),
      });
      if (isStagedResult(updated)) {
        // The edit-approval gate is on: nothing was changed on the card — the
        // edit is now waiting for approval. Return to the card, whose
        // "waiting for approval" notice says so.
        toast.ok('Sent for approval — your changes will apply once an approver signs off.');
        exit.leave(() => void navigate({ to: '/route-cards/$id', params: { id }, replace: true }));
        return;
      }
      opened.saved(updated.updatedAt);
      // ADR-277 — what the server says it did, not the button pressed: a
      // retried save can replay an earlier result.
      toast.ok(rcSavedMessage(updated));
      exit.leave(() => void navigate({ to: '/route-cards/$id', params: { id: updated.id } }));
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Could not save Route Card. Try again.');
    }
  };

  if (isLoading || effPending || mePending) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading route card…
      </div>
    );
  }
  if (isError || !detail) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 'var(--sp-2)' }}>
            <Link to="/route-cards" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Route Card not found.'}
          </div>
        </div>
      </div>
    );
  }

  // ADR-277 — not while our own save is settling: Save & Submit makes this very
  // card locked a moment before the page navigates away from it.
  if (!formOpened.current && !update.isPending && !update.isSuccess) {
    if (isRouteCardLocked(detail.approvalStatus)) {
      return (
        <div className="panel">
          <div className="panel-body">
            <div style={{ marginBottom: 'var(--sp-2)' }}>
              <Link to="/route-cards/$id" params={{ id }} className="btn btn-ghost btn-sm">
                <ArrowLeft size={14} /> Back
              </Link>
            </div>
            <div className="empty-state" style={{ color: 'var(--amber2)' }}>
              {ROUTE_CARD_LOCKED_MESSAGE}
            </div>
          </div>
        </div>
      );
    }
    if (eff && !canEditRouteCard(detail, me?.id, perms)) {
      return (
        <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
          You do not have permission to edit this Route Card. Ask an admin.
        </div>
      );
    }
  }

  formOpened.current = true;
  return (
    <>
      {exit.dialog}
      <RouteCardForm
        mode="edit"
        routeCard={detail}
        initialHeader={{
          code: detail.code,
          itemId: detail.itemId,
          itemCodeText: detail.itemCode ?? '',
          itemName: detail.itemName ?? '',
          drawingRev: detail.drawingRev ?? '',
          drawingFilePath: detail.drawingFilePath,
          rawMaterialGradeId: detail.rawMaterialGradeId,
          rawMaterialGradeText: detail.rawMaterialGradeText,
          rawMaterialSizeId: detail.rawMaterialSizeId,
          rawMaterialSizeText: detail.rawMaterialSizeText,
          rawMaterialItemId: detail.rawMaterialItemId,
          rawMaterialItemCode: detail.rawMaterialItemCode,
          rmQtyPerPiece: detail.rmQtyPerPiece != null ? String(detail.rmQtyPerPiece) : '',
          notes: detail.notes ?? '',
          planType:
            detail.planType === 'full_outsource' || detail.planType === 'direct_purchase'
              ? detail.planType
              : 'manufacture',
        }}
        initialOps={initialOps}
        onSubmit={submit}
        submitting={update.isPending}
        submitError={submitError}
        onCancel={() => exit.leave(goBack)}
        onBack={goBack}
      />
    </>
  );
}
