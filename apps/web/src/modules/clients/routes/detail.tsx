// Client detail page (UI-003-03). Group-4 migration onto the primitives,
// following the approved DETAIL exemplar (modules/vendors/routes/detail.tsx):
//
//   ← Back to Client Master
//   DetailHeader (code + Active chip + Edit/Delete)  →  ReadGrid of ReadFields
//
// A client has no line table and no related-document query, so the
// composition stops at the header panel — same as the vendor, its sibling
// master. What changed is markup only: the hand-rolled panel-hdr, the inline
// "Delete? [Confirm][Cancel]" button swap, the hand-styled red error box and
// the local Pair()/DetailGrid() helpers are gone. The route, the query hooks,
// the `client_create` permission expression and the soft-delete call are
// untouched.
//
// FIELD SIZES — ReadGrid is the same 12-column grid as the edit form's
// FormGrid, and each ReadField carries the size that field will have in
// client-form.tsx once that form is migrated. Keep the two in step:
//
//   Contact person lg · Email lg                        → 6 + 6  = 12
//   Phone lg · GST number lg                            → 6 + 6  = 12
//   City lg · State md · Pincode xs                     → 6+4+2  = 12
//   Address full                                        → 12
//
// The address row is deliberately identical to the vendor's. Phone and GST
// number are wider here than on the vendor page for one reason: a client has
// no Rating, so there is no third field to close that row at md · md · md.

import type { Client } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Button, Icon, StatusBadge } from '@/ui/core';
import { ConfirmDialog } from '@/ui/feedback';
import { DetailHeader, PageState, ReadField, ReadGrid } from '@/ui/layout';
import { useClient, useSoftDeleteClient } from '../api';

export const clientDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'clients/$id',
  component: ClientDetailPage,
});

const BACK_LABEL = 'Back to Customer Master';

/** DetailHeader draws this one itself (`backTo` + `renderLink`). The error
 *  state has no header to hang it on, so it renders the same control on its
 *  own. It stays a real <Link> either way: a button + navigate() would lose
 *  middle-click / ctrl-click / "open in new tab" on a navigation control. */
function BackToMaster(): React.JSX.Element {
  return (
    <Link to="/clients" className="btn btn-ghost btn-sm" style={{ marginBottom: 'var(--sp-2)' }}>
      <Icon name="arrow-left" size={14} /> {BACK_LABEL}
    </Link>
  );
}

function ClientDetailPage(): React.JSX.Element {
  const { id } = clientDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: client, isLoading, isError, error } = useClient(id);
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'client_create');
  const softDelete = useSoftDeleteClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  // "Hide page" (Access Control → Config): once access has loaded, a user
  // whose VIEW was removed for this page sees the no-access panel, not the
  // page. `eff` is undefined only while access is still loading — don't block
  // then, or every legitimate user flashes this panel on cold load. This gate
  // stays AHEAD of the loading/error gates, exactly where it was.
  if (eff && !perms.view) {
    return <PageState state="noaccess" as="page" />;
  }

  if (isLoading) {
    return <PageState state="loading" message="Loading customer…" />;
  }

  if (isError || !client) {
    return (
      <div>
        <BackToMaster />
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Customer not found. Refresh the page.'}
        />
      </div>
    );
  }

  // `mutateAsync`, not `mutate` + onSuccess: ConfirmDialog keeps both of its
  // buttons disabled for as long as this promise is running, so a second
  // Confirm cannot fire a second delete, and a rejection is shown IN the
  // dialog instead of closing the question along with the error.
  const onDelete = async (): Promise<void> => {
    await softDelete.mutateAsync(client.id);
    setConfirmDelete(false);
    await navigate({ to: '/clients', replace: true });
  };

  // Tier-driven, per department (client_create sits in Sales). Delete is not
  // one of the four tier actions, so it is expressed as the pair only L5
  // Department Admin and above hold: edit AND approve. Unchanged.
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;

  const deleteError = softDelete.isError
    ? softDelete.error instanceof Error
      ? softDelete.error.message
      : 'Could not move the customer to Trash. Try again.'
    : null;

  return (
    <div>
      <DetailHeader
        backTo="/clients"
        backLabel={BACK_LABEL}
        renderLink={(p) => <Link {...p} />}
        code={client.code}
        name={client.name}
        badges={<StatusBadge kind="active" status={String(client.isActive)} />}
        actions={
          <>
            {canEdit ? (
              <Link
                to="/clients/$id/edit"
                params={{ id: client.id }}
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
        <ClientFacts client={client} />
      </DetailHeader>

      {confirmDelete ? (
        <ConfirmDialog
          title={`Move Customer ${client.code} to Trash?`}
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

function ClientFacts(props: { client: Client }): React.JSX.Element {
  const { client } = props;
  return (
    <ReadGrid>
      {/* Same order as the Customer form: the address block, then contact. */}
      <ReadField label="Address" size="full" pre value={client.addressLine1} />

      <ReadField label="City" size="lg" value={client.city} />
      <ReadField label="State" size="md" value={client.state} />
      <ReadField label="Pincode" size="xs" mono value={client.pincode} />

      <ReadField label="Contact Person" size="lg" value={client.contactPerson} />
      <ReadField label="Email" size="lg" value={client.email} />

      <ReadField label="Phone" size="lg" mono value={client.phone} />
      <ReadField label="GSTIN" size="lg" mono value={client.gstNumber} />
    </ReadGrid>
  );
}
