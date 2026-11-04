// Cost Centre detail page.
//
//   ← Back to Cost Centre Master
//   DetailHeader (code + name + Active chip + Edit/Delete) → ClusterGrid facts
//
// A flat master with no related documents and no History, so nothing to tab.

import type { CostCenter, DocumentEditChange } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { canDeleteRecords, effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { undecidedChangesOf, usePendingEditForDoc } from '@/modules/document-edits/api';
import {
  PendingChangeChip,
  headerPendingChange,
} from '@/modules/document-edits/components/pending-change-chip';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Button, Icon, StatusBadge } from '@/ui/core';
import { ConfirmDialog } from '@/ui/feedback';
import { PendingFact } from '@/modules/document-edits/components/pending-fact';
import { Cluster, ClusterGrid } from '@/ui/forms';
import { DetailHeader, PageState } from '@/ui/layout';
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
  // ADR-202 — the edit(s) staged against this cost centre and still waiting for a
  // decision. Their per-field changes drive the inline amber chips next to the
  // record fields below. Flattened across requests (usually one).
  const pendingEdit = usePendingEditForDoc('CostCenter', data?.id);
  const pendingChanges = undecidedChangesOf(pendingEdit.data?.rows);

  // Tier-driven (cc_create, Finance). Edit -> edit; Delete -> Super Admin (ADR-232).
  const perms = effectiveFormPerms(eff, 'cc_create');
  const canEdit = perms.edit;
  const canDelete = canDeleteRecords(eff); // ADR-232: delete = L6 Super Admin only

  // "Hide page" (Access Control → Config): once access has loaded, a user
  // whose VIEW was removed for this page sees the no-access panel, not the
  // page. `eff` is undefined only while access loads — don't block then, or
  // every legitimate user flashes this panel on cold load. Same position in
  // the gate order as before.
  if (eff && !perms.view) {
    return <PageState state="noaccess" as="page" />;
  }

  if (isLoading) {
    return <PageState state="loading" message="Loading cost centre…" />;
  }

  if (isError || !data) {
    return (
      <div>
        <BackToMaster />
        <PageState
          state="error"
          message={
            error instanceof Error ? error.message : 'Cost Centre not found. Refresh the page.'
          }
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
        name={readWithChip(data.name, pendingChanges, 'name')}
        badges={
          <>
            <StatusBadge kind="active" status={String(data.isActive)} />
            <Chip changes={pendingChanges} field="isActive" />
          </>
        }
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
        <CostCenterFacts costCenter={data} pendingChanges={pendingChanges} />
      </DetailHeader>

      {confirmDelete ? (
        <ConfirmDialog
          title={`Move Cost Centre ${data.code} to Trash?`}
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

function CostCenterFacts(props: {
  costCenter: CostCenter;
  pendingChanges: readonly DocumentEditChange[];
}): React.JSX.Element {
  const { costCenter, pendingChanges: pc } = props;
  return (
    <ClusterGrid stack>
      <Cluster name="Details">
        <PendingFact
          label="Department"
          value={costCenter.department}
          changes={pc}
          field="department"
        />
        <PendingFact label="Cost Centre Type" value={costCenter.type} changes={pc} field="type" />
        <PendingFact
          span={2}
          wrap
          label="Description"
          value={costCenter.description}
          changes={pc}
          field="description"
        />
      </Cluster>
    </ClusterGrid>
  );
}

/** ADR-202 — the amber "→ after" chip for a record field with a staged edit
 *  waiting for approval. Matched on the Cost Centre edit diff's field key
 *  (COST_CENTER_EDIT_FIELDS). Renders nothing when no edit is pending. */
function Chip(props: {
  changes: readonly DocumentEditChange[];
  field: string;
}): React.JSX.Element | null {
  const c = headerPendingChange(props.changes, props.field);
  return c ? <PendingChangeChip after={c.after} /> : null;
}

/** Compose a header value with its pending-change chip. When no edit is
 *  staged for `field`, the value is returned untouched (blank stays blank). When one
 *  is, the current value
 *  (or an em dash) is shown with the amber "→ after" chip after it. */
function readWithChip(
  value: React.ReactNode,
  changes: readonly DocumentEditChange[],
  field: string,
): React.ReactNode {
  const c = headerPendingChange(changes, field);
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
