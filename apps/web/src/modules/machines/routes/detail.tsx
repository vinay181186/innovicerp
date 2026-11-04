// Machine detail page (UI-003-03). Group-4 migration onto the primitives,
// following the approved DETAIL exemplar (modules/vendors/routes/detail.tsx):
//
//   ← Back
//   DetailHeader (code + name + machine-state chip + Edit/Delete) → ClusterGrid
//
// A machine is a flat master — no line table, no related-document query — so
// the composition stops at the header panel. Markup only: the hand-rolled
// panel-hdr, the inline "Delete? [Confirm][Cancel]" swap, the hand-styled red
// error box, the local Pair()/DetailGrid() helpers and this file's private
// `statusBadgeClass` map are gone. Route, query hooks, the `machine_create`
// permission expression and the soft-delete call are untouched.
//
// THE STATE CHIP moved from the first grid cell to the header, beside the
// code, where the exemplar puts a document's status. Its four colours did not
// change: they are now `StatusBadge kind="machine"` (ui/core/StatusBadge.tsx),
// which carries Running blue · Idle grey · Maintenance amber · Down red
// verbatim from the helper this file used to declare for itself. The list
// still declares its own copy of that helper; swapping it for the same kind is
// a one-line change for whoever migrates machines/routes/list.tsx, and until
// then both draw the same four colours.
//
// Facts: <ClusterGrid stack>, label above value (owner 2026-11-04).

import type { DocumentEditChange, Machine } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { ActionLink } from '@/components/shared/action-link';
import { canDeleteRecords, effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useJobQueue } from '@/modules/job-queue/api';
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
import { useMachine, useMachineGroupLookup, useSoftDeleteMachine } from '../api';

export const machineDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'machines/$id',
  component: MachineDetailPage,
});

const BACK_LABEL = 'Back';

/** DetailHeader draws this one itself (`backTo` + `renderLink`). The error
 *  state has no header to hang it on, so it renders the same control on its
 *  own — and it stays a real <Link>, because a button + navigate() cannot be
 *  middle-clicked, ctrl-clicked or opened in a new tab. */
function BackToMaster(): React.JSX.Element {
  return (
    <Link to="/machines" className="btn btn-ghost btn-sm" style={{ marginBottom: 'var(--sp-2)' }}>
      <Icon name="arrow-left" size={14} /> {BACK_LABEL}
    </Link>
  );
}

function MachineDetailPage(): React.JSX.Element {
  const { id } = machineDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: machine, isLoading, isError, error } = useMachine(id);
  const softDelete = useSoftDeleteMachine();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Read access with the other hooks, ABOVE the isLoading / isError gates below.
  // Called after an early return it runs on some renders and not others, which is
  // React error #310 ("rendered more hooks than during the previous render") the
  // moment the machine finishes loading. Same placement as every sibling detail
  // page. `effectiveFormPerms` is a plain function and stays where it is used.
  const { data: eff } = useMyAccess();
  // "Queue (n) →" — this machine's pending ops, from the same one-fetch view
  // the Job Queue screen reads (cached, so opening the queue after is free).
  const queue = useJobQueue({});
  // ADR-202 — the edit(s) staged against this machine and still waiting for a
  // decision. Their per-field changes drive the inline amber chips next to the
  // record fields below. Flattened across requests (usually one).
  const pendingEdit = usePendingEditForDoc('Machine', machine?.id);
  const pendingChanges = undecidedChangesOf(pendingEdit.data?.rows);

  if (isLoading) {
    return <PageState state="loading" message="⟳ Loading machine…" />;
  }

  if (isError || !machine) {
    return (
      <div>
        <BackToMaster />
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Machine not found.'}
        />
      </div>
    );
  }

  // `mutateAsync`, not `mutate` + onSuccess: ConfirmDialog keeps both buttons
  // disabled while this promise runs, so a second Confirm cannot fire a second
  // delete, and a rejection is shown IN the dialog instead of closing it.
  const onDelete = async (): Promise<void> => {
    await softDelete.mutateAsync(machine.id);
    setConfirmDelete(false);
    await navigate({ to: '/machines', replace: true });
  };

  // Tier-driven, per department.
  const perms = effectiveFormPerms(eff, 'machine_create');
  const canEdit = perms.edit;
  // ADR-232 (owner, 2026-10-15): deleting any record is Super Admin only.
  const canDelete = canDeleteRecords(eff);

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !perms.view) {
    return (
      <PageState
        state="noaccess"
        as="page"
        message="⛔ You do not have permission to view Machines. Ask an admin."
      />
    );
  }

  const queuePending = queue.data
    ? (queue.data.machines.find((m) => m.machineId === machine.id)?.pendingCount ?? 0)
    : null;

  const deleteError = softDelete.isError
    ? softDelete.error instanceof Error
      ? softDelete.error.message
      : 'Could not delete Machine. Try again.'
    : null;

  return (
    <div>
      <DetailHeader
        backTo="/machines"
        backLabel={BACK_LABEL}
        renderLink={(p) => <Link {...p} />}
        code={machine.code}
        name={readWithChip(machine.name, pendingChanges, 'name')}
        badges={
          <>
            <StatusBadge kind="machine" status={machine.status} />
            <Chip changes={pendingChanges} field="status" />
          </>
        }
        actions={
          <>
            {/* Where this machine's work lives — the one queue screen, its
                load, and Op Entry already on this machine. */}
            <Link
              to="/job-queue"
              search={{ machine: machine.code }}
              className="btn btn-ghost btn-sm"
              title="Pending operations on this machine, in queue order"
            >
              Queue ({queuePending ?? '…'}) →
            </Link>
            <Link
              to="/machine-loading"
              search={{ m: machine.id }}
              className="btn btn-ghost btn-sm"
              title="Load, hours pending and days to clear for this machine"
            >
              Loading →
            </Link>
            {/* ADR-234 — shown only to a user who can open Op Entry. */}
            <ActionLink
              to="/op-entry"
              search={{ view: 'machine', machineId: machine.id }}
              className="btn btn-ghost btn-sm"
              title="Op Entry — By Machine, with this machine picked"
            >
              Op Entry →
            </ActionLink>
            {canEdit ? (
              <Link
                to="/machines/$id/edit"
                params={{ id: machine.id }}
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
        <MachineFacts machine={machine} pendingChanges={pendingChanges} />
      </DetailHeader>

      {confirmDelete ? (
        <ConfirmDialog
          title={`Move Machine ${machine.code} to Trash?`}
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

function MachineFacts(props: {
  machine: Machine;
  pendingChanges: readonly DocumentEditChange[];
}): React.JSX.Element {
  const { machine, pendingChanges: pc } = props;
  // The whole group master in one cached fetch (shared with the list and the
  // machine form) — the machine itself only stores the group's id.
  const groupLookup = useMachineGroupLookup();
  const groupCode = machine.machineGroupId
    ? (groupLookup.get(machine.machineGroupId)?.code ?? null)
    : null;
  return (
    <ClusterGrid stack>
      {/* Group first: it is the master-backed field. Type stays exactly as it
          was — free text, alongside the group, not replaced by it. A machine
          with no group (every row created before this change) reads an em dash.
          The staged change (ADR-202) carries the group's raw id — acceptable. */}
      <Cluster name="Machine">
        <PendingFact
          num
          label="Machine Group"
          value={groupCode}
          changes={pc}
          field="machineGroupId"
        />
        <PendingFact
          label="Machine Type"
          value={machine.machineType}
          changes={pc}
          field="machineType"
        />
        <PendingFact
          span={2}
          num
          label="Product Code"
          value={machine.productCode}
          changes={pc}
          field="productCode"
        />
      </Cluster>
      <Cluster name="Capacity">
        <PendingFact
          num
          label="Hours per Shift"
          value={machine.capacityPerShift !== null ? String(machine.capacityPerShift) : null}
          changes={pc}
          field="capacityPerShift"
        />
        <PendingFact
          span={3}
          num
          label="Shifts / Day"
          value={String(machine.shiftsPerDay)}
          changes={pc}
          field="shiftsPerDay"
        />
      </Cluster>
    </ClusterGrid>
  );
}

/** ADR-202 — the amber "→ after" chip for a record field with a staged edit
 *  waiting for approval. Matched on the Machine edit diff's field key
 *  (MACHINE_EDIT_FIELDS). Renders nothing when no edit is pending for that field. */
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
