// Vendor detail page (UI-003-03).
//
//   ← Back to Vendor Master
//   DetailHeader (code + status badge + New PO/Edit/Delete) → ClusterGrid facts
//   Related documents + History tabs, as on Sales Order detail

import {
  type DocumentEditChange,
  type Vendor,
  gstCategoryLabel,
  stateLabel,
} from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { canDeleteRecords, effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useHistoryTab } from '@/components/shared/document-history';
import { RelatedDocsTabs } from '@/components/shared/related-docs-tabs';
import { undecidedChangesOf, usePendingEditForDoc } from '@/modules/document-edits/api';
import {
  PendingChangeChip,
  headerPendingChange,
} from '@/modules/document-edits/components/pending-change-chip';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Button, Icon, StatusBadge } from '@/ui/core';
import { Cluster, ClusterGrid } from '@/ui/forms';
import { PendingFact } from '@/modules/document-edits/components/pending-fact';
import { DetailHeader, PageState } from '@/ui/layout';
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
  const pendingChanges = undecidedChangesOf(pendingEdit.data?.rows);
  // ADR-197 — who created / edited / deleted this vendor, with Before → After.
  const historyTab = useHistoryTab({ entity: 'Vendor', entityId: vendor?.id, refId: vendor?.code });

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
  const perms = effectiveFormPerms(eff, 'vendor_create');
  const canEdit = perms.edit;
  // ADR-232 (owner, 2026-10-15): deleting any record is Super Admin only.
  const canDelete = canDeleteRecords(eff);
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

      {/* Purchase Orders, Delivery Challans Out and GRNs (ADR-190) + History. */}
      <RelatedDocsTabs module="vendors" id={vendor.id} extraTabs={[historyTab]} />

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
    <ClusterGrid stack>
      <Cluster name="Contact">
        <PendingFact
          label="Contact Person"
          value={vendor.contactPerson}
          changes={pc}
          field="contactPerson"
        />
        <PendingFact span={2} label="Email" value={vendor.email} changes={pc} field="email" />
        <PendingFact num label="Phone" value={vendor.phone} changes={pc} field="phone" />
      </Cluster>
      <Cluster name="Tax & terms">
        <PendingFact
          label="Rating"
          value={vendor.rating ? <StatusBadge kind="rating" status={vendor.rating} /> : null}
          changes={pc}
          field="rating"
        />
        <PendingFact num label="GSTIN" value={vendor.gstNumber} changes={pc} field="gstNumber" />
        <PendingFact
          label="GST Category"
          value={gstCategoryLabel(vendor.gstCategory)}
          changes={pc}
          field="gstCategory"
        />
        <PendingFact
          num
          label="Payment Terms (days)"
          value={vendor.paymentTermsDays ?? null}
          changes={pc}
          field="paymentTermsDays"
        />
      </Cluster>
      <Cluster name="Address">
        <PendingFact
          wrap
          label="Address"
          value={vendor.addressLine1}
          changes={pc}
          field="addressLine1"
        />
        <PendingFact label="City" value={vendor.city} changes={pc} field="city" />
        <PendingFact
          label="State"
          value={stateLabel(vendor.stateCode) || vendor.state}
          changes={pc}
          field={['stateCode', 'state']}
        />
        <PendingFact num label="Pincode" value={vendor.pincode} changes={pc} field="pincode" />
      </Cluster>
      <Cluster name="Supplies">
        <PendingFact
          span={4}
          wrap
          label="Materials Supplied"
          value={vendor.materialsSupplied}
          changes={pc}
          field="materialsSupplied"
        />
      </Cluster>
    </ClusterGrid>
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

/** Compose a header value with its pending-change chip. When no edit is
 *  staged for any of `fields`, the value is returned untouched (blank stays blank).
 *  When one is, the
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
