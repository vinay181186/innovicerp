// Cost Centre detail page. Group-4 migration onto the primitives, following
// the approved DETAIL exemplar (modules/vendors/routes/detail.tsx):
//
//   ← Back to Cost Centre Master
//   DetailHeader (code + name + Active chip + Edit/Delete) → ReadGrid
//
// A cost centre is a flat master — no line table, no related-document query —
// so the composition stops at the header panel. Markup only: the hand-rolled
// panel-hdr, the inline "Delete? [Confirm][Cancel]" swap and the hand-styled
// red error box are gone. Route, query hooks, the `cc_create` permission
// expression and the soft-delete call are untouched.
//
// FIELD SIZES — ReadGrid is the same 12-column grid as the edit form's
// FormGrid, and each ReadField carries the size that field will have in
// cost-center-form.tsx once that form is migrated:
//
//   Department lg · Cost Centre Type lg                 → 6 + 6 = 12
//   Description full                                    → 12
//
// The old grid also printed a third "Active" cell in plain text next to the
// chip the panel header already draws. One fact, drawn once: the chip in the
// header is it, and dropping the cell is what closes the row at 6 + 6.

import type { CostCenter } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Button, Icon, StatusBadge } from '@/ui/core';
import { ConfirmDialog } from '@/ui/feedback';
import { DetailHeader, PageState, ReadField, ReadGrid } from '@/ui/layout';
import { useCostCenter, useSoftDeleteCostCenter } from '../api';

export const costCenterDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'cost-centers/$id',
  component: CostCenterDetailPage,
});

const BACK_LABEL = 'Back to Cost Centre Master';

/** DetailHeader draws this one itself (`backTo` + `renderLink`). The error
 *  state has no header to hang it on, so it renders the same control on its
 *  own — and it stays a real <Link>, because a button + navigate() cannot be
 *  middle-clicked, ctrl-clicked or opened in a new tab. */
function BackToMaster(): React.JSX.Element {
  return (
    <Link
      to="/cost-centers"
      className="btn btn-ghost btn-sm"
      style={{ marginBottom: 'var(--sp-2)' }}
    >
      <Icon name="arrow-left" size={14} /> {BACK_LABEL}
    </Link>
  );
}

function CostCenterDetailPage(): React.JSX.Element {
  const { id } = costCenterDetailRoute.useParams();
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useCostCenter(id);
  const { data: eff } = useMyAccess();
  const softDelete = useSoftDeleteCostCenter();
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Tier-driven (cc_create, Finance). Edit -> edit; Delete -> edit AND approve.
  const perms = effectiveFormPerms(eff, 'cc_create');
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;

  // "Hide page" (Access Control → Config): once access has loaded, a user
  // whose VIEW was removed for this page sees the no-access panel, not the
  // page. `eff` is undefined only while access loads — don't block then, or
  // every legitimate user flashes this panel on cold load. Same position in
  // the gate order as before.
  if (eff && !perms.view) {
    return <PageState state="noaccess" as="page" />;
  }

  if (isLoading) {
    return <PageState state="loading" message="⟳ Loading cost centre…" />;
  }

  if (isError || !data) {
    return (
      <div>
        <BackToMaster />
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Cost Centre not found'}
        />
      </div>
    );
  }

  // `mutateAsync`, not `mutate` + onSuccess: ConfirmDialog keeps both buttons
  // disabled while this promise runs, so a second Confirm cannot fire a second
  // delete, and a rejection is shown IN the dialog instead of closing it.
  const onDelete = async (): Promise<void> => {
    await softDelete.mutateAsync(data.id);
    setConfirmDelete(false);
    await navigate({ to: '/cost-centers', replace: true });
  };

  const deleteError = softDelete.isError
    ? softDelete.error instanceof Error
      ? softDelete.error.message
      : 'Could not move the cost centre to Trash. Try again.'
    : null;

  return (
    <div>
      <DetailHeader
        backTo="/cost-centers"
        backLabel={BACK_LABEL}
        renderLink={(p) => <Link {...p} />}
        code={data.code}
        name={data.name}
        badges={<StatusBadge kind="active" status={String(data.isActive)} />}
        actions={
          <>
            {canEdit ? (
              <Link
                to="/cost-centers/$id/edit"
                params={{ id: data.id }}
                className="btn btn-ghost btn-sm"
              >
                <Icon name="pencil" size={13} /> Edit
              </Link>
            ) : null}
            {canDelete ? (
              <Button
                variant="danger"
                size="sm"
                icon={<Icon name="trash-2" size={13} />}
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </Button>
            ) : null}
          </>
        }
      >
        <CostCenterFacts costCenter={data} />
      </DetailHeader>

      {confirmDelete ? (
        <ConfirmDialog
          title={`Move cost centre ${data.code} to Trash?`}
          message={`${data.name} will be removed from the Cost Centre Master. You can restore it from Trash.`}
          confirmLabel="Move to Trash"
          pendingLabel="Moving to Trash…"
          onConfirm={onDelete}
          onCancel={() => setConfirmDelete(false)}
          errorText={deleteError}
        />
      ) : null}
    </div>
  );
}

function CostCenterFacts(props: { costCenter: CostCenter }): React.JSX.Element {
  const { costCenter } = props;
  return (
    <ReadGrid>
      <ReadField label="Department" size="lg" value={costCenter.department} />
      <ReadField label="Cost Centre Type" size="lg" value={costCenter.type} />

      <ReadField label="Description" size="full" pre value={costCenter.description} />
    </ReadGrid>
  );
}
