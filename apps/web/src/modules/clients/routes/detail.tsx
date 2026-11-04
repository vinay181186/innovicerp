// Client detail page (UI-003-03).
//
//   ← Back to Customer Master
//   DetailHeader (code + Active chip + Edit/Delete) → ClusterGrid facts
//   Related documents + History tabs, as on Sales Order detail
//
// State shows "Name (code)" from the State Code, else an old record's free text.

import {
  type Client,
  type DocumentEditChange,
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
  const pendingChanges = undecidedChangesOf(pendingEdit.data?.rows);
  // ADR-197 — who created / edited / deleted this customer, with Before → After.
  const historyTab = useHistoryTab({ entity: 'Client', entityId: client?.id, refId: client?.code });

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
  // one of the page ticks: ADR-232 makes it L6 Super Admin only.
  const canEdit = perms.edit;
  const canDelete = canDeleteRecords(eff); // ADR-232: delete = L6 Super Admin only

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

      {/* Sales Orders, dispatches and outstanding invoices (ADR-190) + History. */}
      <RelatedDocsTabs module="clients" id={client.id} extraTabs={[historyTab]} />

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
    <ClusterGrid stack>
      {/* Same order as the Customer form: the address block, then contact. */}
      <Cluster name="Address">
        <PendingFact
          wrap
          label="Address"
          value={client.addressLine1}
          changes={pc}
          field="addressLine1"
        />
        <PendingFact label="City" value={client.city} changes={pc} field="city" />
        <PendingFact
          label="State"
          value={stateLabel(client.stateCode) || client.state}
          changes={pc}
          field={['stateCode', 'state']}
        />
        <PendingFact num label="Pincode" value={client.pincode} changes={pc} field="pincode" />
      </Cluster>
      <Cluster name="Contact">
        <PendingFact
          label="Contact Person"
          value={client.contactPerson}
          changes={pc}
          field="contactPerson"
        />
        <PendingFact span={2} label="Email" value={client.email} changes={pc} field="email" />
        <PendingFact num label="Phone" value={client.phone} changes={pc} field="phone" />
      </Cluster>
      <Cluster name="Tax & terms">
        <PendingFact num label="GSTIN" value={client.gstNumber} changes={pc} field="gstNumber" />
        <PendingFact
          label="GST Category"
          value={gstCategoryLabel(client.gstCategory)}
          changes={pc}
          field="gstCategory"
        />
        <PendingFact
          span={2}
          num
          label="Payment Days"
          value={client.paymentDays ?? null}
          changes={pc}
          field="paymentDays"
        />
      </Cluster>
    </ClusterGrid>
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
