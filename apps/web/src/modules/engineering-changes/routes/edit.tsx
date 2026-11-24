// Edit an Engineering Change (ADR-291) — Draft only. The save carries the
// version the form opened with (§20.4); a save over a newer edit is refused
// with 409 and the server's words show in the banner.

import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ECR_STATUS_LABELS } from '@innovic/shared';
import { useCallback, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { useDraftSink } from '@/lib/use-form-draft';
import { hardError, RefreshFailedNote } from '@/lib/refresh-failed-note';
import { useOpenedVersion } from '@/lib/use-opened-version';
import { useSaveKey } from '@/lib/use-save-key';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Icon } from '@/ui/core';
import { useToast } from '@/ui/feedback';
import { PageState } from '@/ui/layout';
import { useEcr, useUpdateEcr } from '../api';
import { EcrForm } from '../components/ecr-form';

export const ecrEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'ecrs/$id/edit',
  component: EcrEditPage,
});

function EcrEditPage(): React.JSX.Element {
  const { id } = ecrEditRoute.useParams();
  const navigate = useNavigate();
  const detailQuery = useEcr(id);
  const { data: ecr, isLoading, isError, error } = detailQuery;
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'ecr_create');
  const saveKey = useSaveKey();
  const update = useUpdateEcr(id, saveKey);
  const opened = useOpenedVersion(ecr?.updatedAt);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const goBack = useCallback(
    () => void navigate({ to: '/ecrs/$id', params: { id } }),
    [navigate, id],
  );
  // ADR-313 — the form below keeps a draft; it lands in the sink for the guard.
  const { sink: draftSink, draft: pageDraft } = useDraftSink();
  const exit = useExitConfirm({
    onExit: goBack,
    draft: pageDraft,
  });
  const toast = useToast();

  if (eff && !perms.entry && !perms.edit) {
    return (
      <PageState
        as="page"
        state="noaccess"
        message="You do not have permission to edit Engineering Changes. Ask an admin."
      />
    );
  }
  if (isLoading) return <PageState state="loading" message="⟳ Loading ECR…" />;
  if (!ecr || ecr.status !== 'draft' || hardError(detailQuery)) {
    return (
      <div>
        <Link to="/ecrs" className="btn btn-ghost btn-sm" style={{ marginBottom: 'var(--sp-2)' }}>
          <Icon name="arrow-left" size={14} /> Back to Engineering Change
        </Link>
        <PageState
          state="error"
          message={
            ecr && !hardError(detailQuery)
              ? `${ecr.code} is ${ECR_STATUS_LABELS[ecr.status]} — only a Draft ECR can be edited.`
              : error instanceof Error
                ? error.message
                : 'ECR not found.'
          }
        />
      </div>
    );
  }

  return (
    <>
      {exit.dialog}
      <RefreshFailedNote show={isError} />
      <EcrForm
        draftSlot={{
          key: `ecr-edit:${id}`,
          version: opened.expected() ?? null,
          sink: draftSink,
        }}
        title={`Edit ${ecr.code}`}
        initial={{
          itemId: ecr.itemId,
          itemCode: ecr.itemCode ?? '',
          fromItemRevisionId: ecr.fromItemRevisionId,
          toItemRevisionId: ecr.toItemRevisionId,
          replacementItemId: ecr.replacementItemId,
          replacementItemCode: ecr.replacementItemCode ?? '',
          classification: ecr.classification,
          description: ecr.description,
          customerApproval: ecr.customerApproval,
          customerApprovalRef: ecr.customerApprovalRef ?? '',
        }}
        submitting={update.isPending}
        submitError={submitError}
        saveLabel="Save ECR"
        onCancel={() => exit.leave(goBack)}
        onSubmit={(input) => {
          setSubmitError(null);
          update
            .mutateAsync({ ...input, expectedUpdatedAt: opened.expected() })
            .then((saved) => {
              opened.saved(saved.updatedAt);
              toast.ok(`${saved.code} saved`);
              exit.leave(
                () => void navigate({ to: '/ecrs/$id', params: { id: saved.id }, replace: true }),
              );
            })
            .catch((e: unknown) =>
              setSubmitError(e instanceof Error ? e.message : 'Could not save the ECR. Try again.'),
            );
        }}
      />
    </>
  );
}
