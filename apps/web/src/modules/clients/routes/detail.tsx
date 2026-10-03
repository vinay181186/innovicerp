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
//   Phone md · GSTIN md · GST Category md               → 4+4+4  = 12
//   City lg · State md · Pincode xs                     → 6+4+2  = 12
//   Payment Days xs (ADR-188)                           → 2, row closes
//   Address full                                        → 12
//
// The address row is deliberately identical to the vendor's. GST Category
// (plan v3 Step 2) closes the Phone · GSTIN row at md · md · md; State shows
// "Name (code)" from the State Code, else an old record's free text.

import { type Client, type DocumentEditChange, gstCategoryLabel, stateLabel } from '@innovic/shared';
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
import { useClient, useSoftDeleteClient } from '../api';
import { TrashReasonDialog } from '@/modules/items/components/trash-reason-dialog';

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
  // ADR-202 — the edit(s) staged against this customer and still waiting for a
  // decision. Their per-field changes drive the inline amber chips next to the
  // record fields below. Flattened across requests (usually one).
  const pendingEdit = usePendingEditForDoc('Client', client?.id);
  const pendingChanges = (pendingEdit.data?.rows ?? []).flatMap((r) => r.changes);

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
  const onDelete = async (reason: string): Promise<void> => {
    await softDelete.mutateAsync({ id: client.id, reason });
    setConfirmDelete(false);
    await navigate({ to: '/clients', replace: true });
  };

  // Tier-driven, per department (client_create sits in Sales). Delete is not
  // one of the four tier actions, so it is expressed as the pair only L5
  // Department Admin and above hold: edit AND approve. Unchanged.
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;

  return (
    <div>
      <DetailHeader
        backTo="/clients"
        backLabel={BACK_LABEL}
        renderLink={(p) => <Link {...p} />}
        code={client.code}
        name={readWithChip(client.name, pendingChanges, 'name')}
        badges={
          <>
            <StatusBadge kind="active" status={String(client.isActive)} />
            <Chip changes={pendingChanges} field="isActive" />
          </>
        }
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
        <ClientFacts client={client} pendingChanges={pendingChanges} />
      </DetailHeader>

      {/* Sales Orders, dispatches and outstanding invoices for this customer
          (ADR-190). Hides when empty. */}
      <RelatedDocsPanel module="clients" id={client.id} />

      {/* ADR-197 — who created / edited / deleted this customer, with Before → After. */}
      <Panel title="History" bodyPadding="none">
        <DocumentHistory entity="Client" entityId={client.id} refId={client.code} />
      </Panel>

      {confirmDelete ? (
        <TrashReasonDialog
          title={`Move Customer ${client.code} to Trash?`}
          onConfirm={onDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </div>
  );
}

function ClientFacts(props: {
  client: Client;
  pendingChanges: readonly DocumentEditChange[];
}): React.JSX.Element {
  const { client, pendingChanges: pc } = props;
  return (
    <ReadGrid>
      {/* Same order as the Customer form: the address block, then contact. */}
      <ReadField
        label="Address"
        size="full"
        pre
        value={readWithChip(client.addressLine1, pc, 'addressLine1')}
      />

      <ReadField label="City" size="lg" value={readWithChip(client.city, pc, 'city')} />
      <ReadField
        label="State"
        size="md"
        value={readWithChip(stateLabel(client.stateCode) || client.state, pc, 'stateCode', 'state')}
      />
      <ReadField label="Pincode" size="xs" mono value={readWithChip(client.pincode, pc, 'pincode')} />

      <ReadField
        label="Contact Person"
        size="lg"
        value={readWithChip(client.contactPerson, pc, 'contactPerson')}
      />
      <ReadField label="Email" size="lg" value={readWithChip(client.email, pc, 'email')} />

      <ReadField label="Phone" size="md" mono value={readWithChip(client.phone, pc, 'phone')} />
      <ReadField label="GSTIN" size="md" mono value={readWithChip(client.gstNumber, pc, 'gstNumber')} />
      <ReadField
        label="GST Category"
        size="md"
        value={readWithChip(gstCategoryLabel(client.gstCategory), pc, 'gstCategory')}
      />
      <ReadField
        label="Payment Days"
        size="xs"
        mono
        value={readWithChip(client.paymentDays ?? null, pc, 'paymentDays')}
      />
    </ReadGrid>
  );
}

/** ADR-202 — the amber "→ after" chip for a record field with a staged edit
 *  waiting for approval. Matched on the Client edit diff's field key
 *  (CLIENT_FIELDS). Renders nothing when no edit is pending for that field. */
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
