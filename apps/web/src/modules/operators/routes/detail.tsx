// Operator detail page (UI-003-03). Group-4 migration onto the primitives,
// following the approved DETAIL exemplar (modules/vendors/routes/detail.tsx):
//
//   ← Back
//   DetailHeader (code + name + Active chip + Edit/Delete) → ReadGrid
//
// An operator is a flat master — no line table, no related-document query —
// so the composition stops at the header panel. Markup only: the hand-rolled
// panel-hdr, the inline "Delete? [Confirm][Cancel]" swap, the hand-styled red
// error box and the local Pair()/DetailGrid() helpers are gone. Route, query
// hooks, the `operator_create` permission expression and the soft-delete call
// are untouched.
//
// THE ACTIVE CHIP moved from the first grid cell to the header, beside the
// code, where the exemplar puts it. It is the app's one Active/Inactive chip
// (`StatusBadge kind="active"`), the same one the vendor detail page and the
// migrated client list already draw.
//
// FIELD SIZES — ReadGrid is the same 12-column grid as the edit form's
// FormGrid, and each ReadField carries the size that field will have in
// operator-form.tsx once that form is migrated:
//
//   Department lg · Linked user lg                      → 6 + 6 = 12
//   Skills / Machines full                              → 12
//
// Linked user shows the login's NAME (looked up in the Task Board's active-user
// list); only a link to a user missing from that list falls back to the id.

import type { Operator } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Button, Icon, StatusBadge } from '@/ui/core';
import { useTaskUserOptions } from '@/modules/tasks/api';
import { ConfirmDialog } from '@/ui/feedback';
import { DetailHeader, PageState, ReadField, ReadGrid } from '@/ui/layout';
import { useOperator, useSoftDeleteOperator } from '../api';

export const operatorDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'operators/$id',
  component: OperatorDetailPage,
});

const BACK_LABEL = 'Back';

/** DetailHeader draws this one itself (`backTo` + `renderLink`). The error
 *  state has no header to hang it on, so it renders the same control on its
 *  own — and it stays a real <Link>, because a button + navigate() cannot be
 *  middle-clicked, ctrl-clicked or opened in a new tab. */
function BackToMaster(): React.JSX.Element {
  return (
    <Link to="/operators" className="btn btn-ghost btn-sm" style={{ marginBottom: 'var(--sp-2)' }}>
      <Icon name="arrow-left" size={14} /> {BACK_LABEL}
    </Link>
  );
}

function OperatorDetailPage(): React.JSX.Element {
  const { id } = operatorDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: operator, isLoading, isError, error } = useOperator(id);
  const { data: eff } = useMyAccess();
  const softDelete = useSoftDeleteOperator();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isLoading) {
    return <PageState state="loading" message="⟳ Loading operator…" />;
  }

  if (isError || !operator) {
    return (
      <div>
        <BackToMaster />
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Operator not found.'}
        />
      </div>
    );
  }

  // `mutateAsync`, not `mutate` + onSuccess: ConfirmDialog keeps both buttons
  // disabled while this promise runs, so a second Confirm cannot fire a second
  // delete, and a rejection is shown IN the dialog instead of closing it.
  const onDelete = async (): Promise<void> => {
    await softDelete.mutateAsync(operator.id);
    setConfirmDelete(false);
    await navigate({ to: '/operators', replace: true });
  };

  // Tier-driven, per department (operator_create sits in Production). Edit = edit
  // (L3+); Delete = the edit+approve pair only L5+ hold.
  const perms = effectiveFormPerms(eff, 'operator_create');
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !perms.view) {
    return <PageState state="noaccess" as="page" />;
  }

  const deleteError = softDelete.isError
    ? softDelete.error instanceof Error
      ? softDelete.error.message
      : 'Could not delete Operator. Try again.'
    : null;

  return (
    <div>
      <DetailHeader
        backTo="/operators"
        backLabel={BACK_LABEL}
        renderLink={(p) => <Link {...p} />}
        code={operator.code}
        name={operator.name}
        badges={<StatusBadge kind="active" status={String(operator.isActive)} />}
        actions={
          <>
            {canEdit ? (
              <Link
                to="/operators/$id/edit"
                params={{ id: operator.id }}
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
        <OperatorFacts operator={operator} />
      </DetailHeader>

      {confirmDelete ? (
        <ConfirmDialog
          title={`Move Operator ${operator.code} to Trash?`}
          message="You can restore it from Trash."
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

function OperatorFacts(props: { operator: Operator }): React.JSX.Element {
  const { operator } = props;
  const { data: users } = useTaskUserOptions(Boolean(operator.userId));
  const linkedName = operator.userId
    ? (users?.options.find((u) => u.id === operator.userId)?.name ?? 'User not in the active list')
    : null;
  return (
    <ReadGrid>
      <ReadField label="Department" size="lg" value={operator.department} />
      <ReadField label="Linked User" size="lg" value={linkedName} />

      <ReadField label="Skills / Machines" size="full" pre value={operator.skills} />
    </ReadGrid>
  );
}
