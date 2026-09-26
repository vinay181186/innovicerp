// Machine detail page (UI-003-03). Group-4 migration onto the primitives,
// following the approved DETAIL exemplar (modules/vendors/routes/detail.tsx):
//
//   ← Back to Machine Master
//   DetailHeader (code + name + machine-state chip + Edit/Delete) → ReadGrid
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
// FIELD SIZES — ReadGrid is the same 12-column grid as the edit form's
// FormGrid, and each ReadField carries the size that field will have in
// machine-form.tsx once that form is migrated:
//
//   Machine group md · Machine type md · Product code md → 4+4+4 = 12
//   Capacity / shift lg · Shifts / day lg                → 6 + 6 = 12
//
// The two numbers take lg rather than sm for one reason: with the state chip
// in the header there is no third field to close that row, and every row of
// the grid must sum to 12.

import type { Machine } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Button, Icon, StatusBadge } from '@/ui/core';
import { ConfirmDialog } from '@/ui/feedback';
import { DetailHeader, PageState, ReadField, ReadGrid } from '@/ui/layout';
import { useMachine, useMachineGroupLookup, useSoftDeleteMachine } from '../api';

export const machineDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'machines/$id',
  component: MachineDetailPage,
});

const BACK_LABEL = 'Back to Machine Master';

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

  if (isLoading) {
    return <PageState state="loading" message="⟳ Loading machine…" />;
  }

  if (isError || !machine) {
    return (
      <div>
        <BackToMaster />
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Machine not found'}
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

  // Tier-driven, per department. Delete is not one of the four tier actions,
  // so it is expressed as the pair only L5 Department Admin and above hold:
  // edit AND approve. L3 has edit without approve; L4 has approve without edit.
  // Previously delete was admin-only, which locked out the tier meant to run
  // the department.
  const perms = effectiveFormPerms(eff, 'machine_create');
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
      : 'Failed to delete machine.'
    : null;

  return (
    <div>
      <DetailHeader
        backTo="/machines"
        backLabel={BACK_LABEL}
        renderLink={(p) => <Link {...p} />}
        code={machine.code}
        name={machine.name}
        badges={<StatusBadge kind="machine" status={machine.status} />}
        actions={
          <>
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
        <MachineFacts machine={machine} />
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

function MachineFacts(props: { machine: Machine }): React.JSX.Element {
  const { machine } = props;
  // The whole group master in one cached fetch (shared with the list and the
  // machine form) — the machine itself only stores the group's id.
  const groupLookup = useMachineGroupLookup();
  const groupCode = machine.machineGroupId
    ? (groupLookup.get(machine.machineGroupId)?.code ?? null)
    : null;
  return (
    <ReadGrid>
      {/* Group first: it is the master-backed field. Type stays exactly as it
          was — free text, alongside the group, not replaced by it. A machine
          with no group (every row created before this change) reads an em dash. */}
      <ReadField label="Machine group" size="md" mono value={groupCode} />
      <ReadField label="Machine type" size="md" value={machine.machineType} />
      <ReadField label="Product code" size="md" mono value={machine.productCode} />

      <ReadField
        label="Capacity / shift"
        size="lg"
        mono
        value={machine.capacityPerShift !== null ? `${machine.capacityPerShift} h` : null}
      />
      <ReadField label="Shifts / day" size="lg" mono value={String(machine.shiftsPerDay)} />
    </ReadGrid>
  );
}
