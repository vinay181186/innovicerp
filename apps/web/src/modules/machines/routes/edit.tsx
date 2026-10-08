// Machine new + edit routes (UI-003-03).

import type { CreateMachineInput, UpdateMachineInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useExitConfirm } from '@/lib/exit-guard';
import { useEditConflict } from '@/lib/use-edit-conflict';
import { useSaveKey } from '@/lib/use-save-key';
import { isStagedResult } from '@/modules/document-edits/api';
import { Banner } from '@/ui/feedback';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateMachine, useFetchMachine, useMachine, useUpdateMachine } from '../api';
import { MachineForm } from '../components/machine-form';

// ADR-226 — the fields THIS screen can edit, and what the user calls each one.
//
// The list drives two things: the save sends only the ones whose value actually
// changed, and a notice names the field another person moved. It is written out
// rather than inferred: `code` is read-only on the edit form (and omitted from
// updateMachineInputSchema outright), and the machine record also carries the
// audit columns, which are nobody's edit.
//
// The Machine Group tab is a SEPARATE master with its own rows — nothing from it
// belongs in this list.
const MACHINE_EDITABLE = [
  'machineGroupId',
  'name',
  'productCode',
  'machineType',
  'capacityPerShift',
  'shiftsPerDay',
  'hourRate',
  'status',
] as const;

// `Hours per Shift` and `Hour Rate` are the registered names (docs/NAMING.md,
// the 2026-09-30 naming audit rows for `machines` shift config and
// `machines.hour_rate`) — NOT "Capacity / Shift" and NOT "Machine Rate". The
// other five have no register row; these are the labels already on the form.
const MACHINE_LABELS: Record<string, string> = {
  machineGroupId: 'Machine Group',
  name: 'Machine Name',
  productCode: 'Product Code',
  machineType: 'Machine Type',
  capacityPerShift: 'Hours per Shift',
  shiftsPerDay: 'Shifts / Day',
  hourRate: 'Hour Rate',
  status: 'Machine Status',
};

export const machineNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'machines/new',
  component: MachineNewPage,
});

export const machineEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'machines/$id/edit',
  component: MachineEditPage,
});

function MachineNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const saveKey = useSaveKey();
  const create = useCreateMachine(saveKey);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const goBack = useCallback(() => void navigate({ to: '/machines' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });

  const onSubmit = async (values: CreateMachineInput): Promise<void> => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync(values);
      exit.leave(
        () => void navigate({ to: '/machines/$id', params: { id: created.id }, replace: true }),
      );
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save Machine. Try again.');
    }
  };

  return (
    <div>
      {exit.dialog}
      <Link to="/machines" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            {/* Legacy modal title: showModal('Add Machine', …) L13137. */}
            <div className="panel-title">Add Machine</div>
          </div>
        </div>
        <div className="panel-body">
          <MachineForm
            mode="create"
            onSubmit={onSubmit}
            submitError={submitError}
            onCancel={() => exit.leave(goBack)}
          />
        </div>
      </div>
    </div>
  );
}

function MachineEditPage(): React.JSX.Element {
  const { id } = machineEditRoute.useParams();
  const navigate = useNavigate();
  const { data: machine, isLoading, isError, error } = useMachine(id);
  const update = useUpdateMachine(id);
  const fetchMachine = useFetchMachine();
  // ADR-226 / §20.4 — sends only what changed, merges onto someone else's save
  // instead of overwriting it, and raises the 3-second notice. Also subscribes
  // to this one machine, so the user is told the moment somebody else saves it
  // rather than after they have typed into a stale form.
  const conflict = useEditConflict({
    table: 'machines',
    id,
    record: machine,
    refetch: () => fetchMachine(id),
    editableKeys: MACHINE_EDITABLE,
    label: (f) => MACHINE_LABELS[f] ?? f,
    noun: 'machine',
  });
  const [submitError, setSubmitError] = useState<string | null>(null);
  // ADR-202 — set when an edit to a LIVE machine is staged for approval instead
  // of applied; the neutral "Sent for approval" banner shows it.
  const [stagedNotice, setStagedNotice] = useState<string | null>(null);

  const goBack = useCallback(
    () => void navigate({ to: '/machines/$id', params: { id } }),
    [navigate, id],
  );
  const exit = useExitConfirm({ onExit: goBack });

  const onSubmit = async (values: UpdateMachineInput): Promise<void> => {
    setSubmitError(null);
    try {
      // Only the fields that actually moved are sent; a 409 re-reads and retries
      // onto the fresh row instead of overwriting someone else's change.
      const result = await conflict.save(values, (payload, expectedUpdatedAt) =>
        update.mutateAsync({ ...payload, expectedUpdatedAt }),
      );
      // null = nothing actually changed; the user has been told and nothing was
      // written. Stay on the form.
      if (result === null) return;
      if (isStagedResult(result)) {
        // The edit-approval gate is on and this machine is live: nothing was
        // changed on the machine — the edit is now waiting for approval. Say so,
        // then return to the machine (its fields now carry the pending chip).
        setStagedNotice('Sent for approval — your changes will apply once an approver signs off.');
      }
      exit.leave(() => void navigate({ to: '/machines/$id', params: { id }, replace: true }));
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save Machine. Try again.');
    }
  };

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading machine…
      </div>
    );
  }

  if (isError || !machine) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/machines" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Machine not found.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {exit.dialog}
      <Link
        to="/machines/$id"
        params={{ id }}
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 10 }}
      >
        <ArrowLeft size={14} /> Back
      </Link>
      {stagedNotice ? (
        <Banner tone="success" role="status">
          {stagedNotice}
        </Banner>
      ) : null}
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div
              className="td-code"
              style={{ color: 'var(--cyan)', fontSize: 14, fontWeight: 700 }}
            >
              {machine.code}
            </div>
            <div className="panel-title" style={{ marginTop: 2 }}>
              Edit Machine
            </div>
          </div>
        </div>
        <div className="panel-body">
          <MachineForm
            mode="edit"
            machine={machine}
            onSubmit={onSubmit}
            submitError={submitError}
            onCancel={() => exit.leave(goBack)}
          />
        </div>
      </div>
    </div>
  );
}
