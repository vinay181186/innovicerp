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
//   Rating md · Phone md · GSTIN md                     → 4+4+4  = 12
//   GST Category md · Payment Terms (days) md           → 4+4, row closes
//   City lg · State md · Pincode xs                     → 6+4+2  = 12
//   Materials supplied full · Address full              → 12 each
//
// Every row sums to 12, so a value sits in exactly the slot its input occupies.

import { type DocumentEditChange, type Vendor, gstCategoryLabel, stateLabel } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { DocumentHistory } from '@/components/shared/document-history';
import { RelatedDocsPanel } from '@/components/shared/related-docs-panel';
import { usePendingEditForDoc } from '@/modules/document-edits/api';
import {
  PendingChangeChip,
  headerPendingChange,
} from '@/modules/document-edits/components/pending-change-chip';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Button, Icon, StatusBadge } from '@/ui/core';
import { Panel } from '@/ui/data';
import { DetailHeader, PageState, ReadField, ReadGrid } from '@/ui/layout';
import { useSoftDeleteVendor, useVendor } from '../api';
import { TrashReasonDialog } from '@/modules/items/components/trash-reason-dialog';

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
  // ADR-202 — the edit(s) staged against this vendor and still waiting for a
  // decision. Their per-field changes drive the inline amber chips next to the
  // record fields below. Flattened across requests (usually one).
  const pendingEdit = usePendingEditForDoc('Vendor', vendor?.id);
  const pendingChanges = (pendingEdit.data?.rows ?? []).flatMap((r) => r.changes);

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

  const onDelete = async (reason: string): Promise<void> => {
    await softDelete.mutateAsync({ id: vendor.id, reason });
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
  // "New PO" raises a purchase order to this vendor — gated on the PO's own
  // entry right, the same gate /purchase-orders/from-pr enforces.
  const canCreatePo = effectiveFormPerms(eff, 'po_create').entry;

  // "Hide page" (Access Control → Config): once access has loaded, a user
  // whose VIEW was removed for this page sees the no-access panel, not the
  // page. `eff` is undefined only while access is still loading — don't block
  // then, or every legitimate user flashes this panel on cold load.
  if (eff && !perms.view) {
    return <PageState state="noaccess" as="page" />;
  }

  return (
    <div>
      <DetailHeader
        backTo="/vendors"
        backLabel={BACK_LABEL}
        renderLink={(p) => <Link {...p} />}
        code={vendor.code}
        name={readWithChip(vendor.name, pendingChanges, 'name')}
        badges={
          <>
            <StatusBadge kind="active" status={String(vendor.isActive)} />
            <Chip changes={pendingChanges} field="isActive" />
          </>
        }
        actions={
          <>
            {/* The one next step on a vendor: buy from them. Opens the PO form
                with this vendor already in the Vendor box. */}
            {canCreatePo ? (
              <Link
                to="/purchase-orders/from-pr"
                search={{ vendorId: vendor.id }}
                className="btn btn-primary btn-sm"
              >
                <Icon name="plus" size={13} /> New PO
              </Link>
            ) : null}
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
        <VendorFacts vendor={vendor} pendingChanges={pendingChanges} />
      </DetailHeader>

      {/* Purchase Orders, Delivery Challans Out and GRNs for this vendor
          (ADR-190). Hides when empty. */}
      <RelatedDocsPanel module="vendors" id={vendor.id} />

      {/* ADR-197 — who created / edited / deleted this vendor, with Before → After. */}
      <Panel title="History" bodyPadding="none">
        <DocumentHistory entity="Vendor" entityId={vendor.id} refId={vendor.code} />
      </Panel>

      {confirmDelete ? (
        <TrashReasonDialog
          title={`Move Vendor ${vendor.code} to Trash?`}
          onConfirm={onDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </div>
  );
}

function VendorFacts(props: {
  vendor: Vendor;
  pendingChanges: readonly DocumentEditChange[];
}): React.JSX.Element {
  const { vendor, pendingChanges: pc } = props;
  return (
    <ReadGrid>
      <ReadField
        label="Contact Person"
        size="lg"
        value={readWithChip(vendor.contactPerson, pc, 'contactPerson')}
      />
      <ReadField label="Email" size="lg" value={readWithChip(vendor.email, pc, 'email')} />

      <ReadField
        label="Rating"
        size="md"
        value={readWithChip(
          vendor.rating ? <StatusBadge kind="rating" status={vendor.rating} /> : null,
          pc,
          'rating',
        )}
      />
      <ReadField label="Phone" size="md" mono value={readWithChip(vendor.phone, pc, 'phone')} />
      <ReadField label="GSTIN" size="md" mono value={readWithChip(vendor.gstNumber, pc, 'gstNumber')} />

      <ReadField
        label="GST Category"
        size="md"
        value={readWithChip(gstCategoryLabel(vendor.gstCategory), pc, 'gstCategory')}
      />
      <ReadField
        label="Payment Terms (days)"
        size="md"
        mono
        value={readWithChip(vendor.paymentTermsDays ?? null, pc, 'paymentTermsDays')}
      />

      <ReadField label="City" size="lg" value={readWithChip(vendor.city, pc, 'city')} />
      <ReadField
        label="State"
        size="md"
        value={readWithChip(stateLabel(vendor.stateCode) || vendor.state, pc, 'stateCode', 'state')}
      />
      <ReadField label="Pincode" size="xs" mono value={readWithChip(vendor.pincode, pc, 'pincode')} />

      <ReadField
        label="Materials Supplied"
        size="full"
        pre
        value={readWithChip(vendor.materialsSupplied, pc, 'materialsSupplied')}
      />
      <ReadField
        label="Address"
        size="full"
        pre
        value={readWithChip(vendor.addressLine1, pc, 'addressLine1')}
      />
    </ReadGrid>
  );
}

/** ADR-202 — the amber "→ after" chip for a record field with a staged edit
 *  waiting for approval. Matched on the Vendor edit diff's field key
 *  (VENDOR_FIELDS). Renders nothing when no edit is pending for that field. */
function Chip(props: {
  changes: readonly DocumentEditChange[];
  field: string;
}): React.JSX.Element | null {
  const c = headerPendingChange(props.changes, props.field);
  return c ? <PendingChangeChip after={c.after} /> : null;
}

/** Compose a ReadField value with its pending-change chip. When no edit is
 *  staged for any of `fields`, the value is returned untouched so ReadField's
 *  own empty handling (em dash in --text3) still applies. When one is, the
 *  current value (or an em dash) is shown with the amber "→ after" chip after
 *  it. `fields` takes more than one key for a value fed by two columns (State
 *  shows the State Code's label, so it watches both stateCode and state). */
function readWithChip(
  value: React.ReactNode,
  changes: readonly DocumentEditChange[],
  ...fields: string[]
): React.ReactNode {
  const c = fields.map((f) => headerPendingChange(changes, f)).find(Boolean);
  if (!c) return value;
  const base =
    value == null || value === '' ? <span style={{ color: 'var(--text3)' }}>—</span> : value;
  return (
    <>
      {base}
      <PendingChangeChip after={c.after} />
    </>
  );
}
