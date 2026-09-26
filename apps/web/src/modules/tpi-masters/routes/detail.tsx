// TPI Master detail page. Group-4 migration onto the primitives, following
// the approved DETAIL exemplar (modules/vendors/routes/detail.tsx):
//
//   ← Back to TPI Master
//   DetailHeader (name + "🔍 TPI Inspector" + Active chip + Edit/Delete) → ReadGrid
//
// An inspector is a flat master — no line table, no related-document query —
// so the composition stops at the header panel. Markup only: the hand-rolled
// panel-hdr, the inline "Delete? [Confirm][Cancel]" swap and the hand-styled
// red error box are gone. Route, query hooks, the `tpimaster_create`
// permission expression and the soft-delete call are untouched.
//
// `code` IS THE INSPECTOR'S NAME (schemas/tpi-master.ts: stored in `code` so
// this master matches its QC Process Master sibling column for column, and
// permanent once created because every TPI log snapshots it), so it is what
// DetailHeader prints as the document code, with the screen's own
// "🔍 TPI Inspector" line under it exactly as before.
//
// THE ACTIVE CHIP is `StatusBadge kind="masteractive"` — green / AMBER, the
// colours this screen and its list have always drawn, NOT the generic
// `active` map's green / red. Same reasoning as the QC Process Master it is
// modelled on: a retired inspector is a row taken out of the pickers, not a
// fault, and painting it red here would put the chip at odds with
// tpi-masters/routes/list.tsx, which paints the same amber.
//
// FIELD SIZES — ReadGrid is the same 12-column grid as the edit form's
// FormGrid, and each ReadField carries the size that field will have in
// tpi-master-form.tsx once that form is migrated:
//
//   Organization md · Contact No. md · Email md         → 4+4+4 = 12
//   Remarks full                                        → 12
//
// The old grid also printed an "Active" cell in plain text next to the chip
// the panel header already draws. One fact, drawn once: the chip is it.

import type { TpiMaster } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Button, Icon, StatusBadge } from '@/ui/core';
import { ConfirmDialog } from '@/ui/feedback';
import { DetailHeader, PageState, ReadField, ReadGrid } from '@/ui/layout';
import { useSoftDeleteTpiMaster, useTpiMaster } from '../api';

export const tpiMasterDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'tpi-masters/$id',
  component: TpiMasterDetailPage,
});

const BACK_LABEL = 'Back to TPI Master';

/** DetailHeader draws this one itself (`backTo` + `renderLink`). The error
 *  state has no header to hang it on, so it renders the same control on its
 *  own — and it stays a real <Link>, because a button + navigate() cannot be
 *  middle-clicked, ctrl-clicked or opened in a new tab. */
function BackToMaster(): React.JSX.Element {
  return (
    <Link
      to="/tpi-masters"
      className="btn btn-ghost btn-sm"
      style={{ marginBottom: 'var(--sp-2)' }}
    >
      <Icon name="arrow-left" size={14} /> {BACK_LABEL}
    </Link>
  );
}

function TpiMasterDetailPage(): React.JSX.Element {
  const { id } = tpiMasterDetailRoute.useParams();
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useTpiMaster(id);
  const softDelete = useSoftDeleteTpiMaster();
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Tier-driven, matching the list and the new/edit routes. Delete is not one
  // of the four tier actions, so "L5 Department Admin and above" is expressed
  // as the pair only L5/L6 hold: L3 Editor has edit without approve, L4
  // Approver has approve without edit.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'tpimaster_create');
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;

  if (isLoading) {
    return <PageState state="loading" message="⟳ Loading inspector…" />;
  }

  if (isError || !data) {
    return (
      <div>
        <BackToMaster />
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Inspector not found.'}
        />
      </div>
    );
  }

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !perms.view) {
    return <PageState state="noaccess" as="page" />;
  }

  // `mutateAsync`, not `mutate` + onSuccess: ConfirmDialog keeps both buttons
  // disabled while this promise runs, so a second Confirm cannot fire a second
  // delete, and a rejection is shown IN the dialog instead of closing it.
  const onDelete = async (): Promise<void> => {
    await softDelete.mutateAsync(data.id);
    setConfirmDelete(false);
    await navigate({ to: '/tpi-masters', replace: true });
  };

  const deleteError = softDelete.isError
    ? softDelete.error instanceof Error
      ? softDelete.error.message
      : 'Could not delete Inspector. Try again.'
    : null;

  return (
    <div>
      <DetailHeader
        backTo="/tpi-masters"
        backLabel={BACK_LABEL}
        renderLink={(p) => <Link {...p} />}
        code={data.code}
        name="🔍 TPI Inspector"
        badges={<StatusBadge kind="masteractive" status={String(data.isActive)} />}
        actions={
          <>
            {canEdit ? (
              <Link
                to="/tpi-masters/$id/edit"
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
        <TpiMasterFacts inspector={data} />
      </DetailHeader>

      {confirmDelete ? (
        <ConfirmDialog
          title={`Delete inspector ${data.code}?`}
          message="They will be removed from the TPI Master and from the inspector pickers. TPI logs already signed off keep the name they recorded."
          confirmLabel="Delete"
          pendingLabel="Deleting…"
          onConfirm={onDelete}
          onCancel={() => setConfirmDelete(false)}
          errorText={deleteError}
        />
      ) : null}
    </div>
  );
}

function TpiMasterFacts(props: { inspector: TpiMaster }): React.JSX.Element {
  const { inspector } = props;
  return (
    <ReadGrid>
      <ReadField label="Organization" size="md" value={inspector.organization} />
      <ReadField label="Contact No." size="md" mono value={inspector.contactNo} />
      <ReadField label="Email" size="md" value={inspector.email} />

      <ReadField label="Remarks" size="full" pre value={inspector.remarks} />
    </ReadGrid>
  );
}
