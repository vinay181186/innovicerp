// Vendor detail page (UI-003-03). Group-3 reference migration: the canonical
// DETAIL composition from design-ref/README.md —
//
//   ← Back to Vendor Master
//   DetailHeader (code + status badge + Edit/Delete)  →  ReadGrid of ReadFields
//
// There are no line tables and no related documents on a vendor, so the
// composition stops at the header panel. Nothing about the data, the access
// gate or the delete call changed; only the markup did.
//
// FIELD SIZES — ReadGrid is the same 12-column grid as the edit form's
// FormGrid, and each ReadField carries the size that field will have in
// vendor-form.tsx once that form is migrated (Group 2). Keep the two in step:
//
//   Contact person lg · Email lg                        → 6 + 6  = 12
//   Rating md · Phone md · GST number md                → 4+4+4  = 12
//   City lg · State md · Pincode xs                     → 6+4+2  = 12
//   Materials supplied full · Address full              → 12 each
//
// Every row sums to 12, so a value sits in exactly the slot its input occupies.

import type { Vendor } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Button, Icon, StatusBadge } from '@/ui/core';
import { ConfirmDialog } from '@/ui/feedback';
import { DetailHeader, PageState, ReadField, ReadGrid } from '@/ui/layout';
import { useSoftDeleteVendor, useVendor } from '../api';

export const vendorDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'vendors/$id',
  component: VendorDetailPage,
});

const BACK_LABEL = 'Back to Vendor Master';

/** DetailHeader draws this one itself (`backTo` + `renderLink`). The error
 *  state has no header to hang it on, so it renders the same control on its
 *  own. It stays a real <Link> either way: a button + navigate() would lose
 *  middle-click / ctrl-click / "open in new tab" on a navigation control. */
function BackToMaster(): React.JSX.Element {
  return (
    <Link to="/vendors" className="btn btn-ghost btn-sm" style={{ marginBottom: 'var(--sp-2)' }}>
      <Icon name="arrow-left" size={14} /> {BACK_LABEL}
    </Link>
  );
}

function VendorDetailPage(): React.JSX.Element {
  const { id } = vendorDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: vendor, isLoading, isError, error } = useVendor(id);
  const { data: eff } = useMyAccess();
  const softDelete = useSoftDeleteVendor();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isLoading) {
    return <PageState state="loading" message="⟳ Loading vendor…" />;
  }

  if (isError || !vendor) {
    return (
      <div>
        <BackToMaster />
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Vendor not found. Refresh the page.'}
        />
      </div>
    );
  }

  const onDelete = async (): Promise<void> => {
    await softDelete.mutateAsync(vendor.id);
    setConfirmDelete(false);
    await navigate({ to: '/vendors', replace: true });
  };

  // Tier-driven, per department (vendor_create sits in Purchase). Replaces the
  // old admin/manager + admin flags, which collapsed all seven tiers into two.
  // Delete is not one of the four tier actions, so it is expressed as the pair
  // only L5 Department Admin and above hold: edit AND approve. L3 Editor has
  // edit without approve; L4 Approver has approve without edit. Delete was
  // admin-only, which locked out the very tier meant to run the department.
  const perms = effectiveFormPerms(eff, 'vendor_create');
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;

  // "Hide page" (Access Control → Config): once access has loaded, a user
  // whose VIEW was removed for this page sees the no-access panel, not the
  // page. `eff` is undefined only while access is still loading — don't block
  // then, or every legitimate user flashes this panel on cold load.
  if (eff && !perms.view) {
    return <PageState state="noaccess" as="page" />;
  }

  const deleteError = softDelete.isError
    ? softDelete.error instanceof Error
      ? softDelete.error.message
      : 'Could not delete Vendor. Try again.'
    : null;

  return (
    <div>
      <DetailHeader
        backTo="/vendors"
        backLabel={BACK_LABEL}
        renderLink={(p) => <Link {...p} />}
        code={vendor.code}
        name={vendor.name}
        badges={<StatusBadge kind="active" status={String(vendor.isActive)} />}
        actions={
          <>
            {canEdit ? (
              <Link
                to="/vendors/$id/edit"
                params={{ id: vendor.id }}
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
        <VendorFacts vendor={vendor} />
      </DetailHeader>

      {confirmDelete ? (
        <ConfirmDialog
          title={`Move Vendor ${vendor.code} to Trash?`}
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

function VendorFacts(props: { vendor: Vendor }): React.JSX.Element {
  const { vendor } = props;
  return (
    <ReadGrid>
      <ReadField label="Contact Person" size="lg" value={vendor.contactPerson} />
      <ReadField label="Email" size="lg" value={vendor.email} />

      <ReadField
        label="Rating"
        size="md"
        value={vendor.rating ? <StatusBadge kind="rating" status={vendor.rating} /> : null}
      />
      <ReadField label="Phone" size="md" mono value={vendor.phone} />
      <ReadField label="GST No." size="md" mono value={vendor.gstNumber} />

      <ReadField label="City" size="lg" value={vendor.city} />
      <ReadField label="State" size="md" value={vendor.state} />
      <ReadField label="Pincode" size="xs" mono value={vendor.pincode} />

      <ReadField label="Materials Supplied" size="full" pre value={vendor.materialsSupplied} />
      <ReadField label="Address" size="full" pre value={vendor.addressLine1} />
    </ReadGrid>
  );
}
