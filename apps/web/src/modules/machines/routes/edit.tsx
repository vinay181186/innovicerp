// Machine new + edit routes (UI-003-03).

import type { CreateMachineInput, UpdateMachineInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateMachine, useMachine, useUpdateMachine } from '../api';
import { MachineForm } from '../components/machine-form';

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
  const create = useCreateMachine();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: CreateMachineInput): Promise<void> => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync(values);
      await navigate({ to: '/machines/$id', params: { id: created.id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create machine');
    }
  };

  return (
    <div>
      <Link to="/machines" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Machine Master
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
            onCancel={() => void navigate({ to: '/machines' })}
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
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: UpdateMachineInput): Promise<void> => {
    setSubmitError(null);
    try {
      await update.mutateAsync(values);
      await navigate({ to: '/machines/$id', params: { id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update machine');
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
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Machine not found'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link
        to="/machines/$id"
        params={{ id }}
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 10 }}
      >
        <ArrowLeft size={14} /> Back to machine
      </Link>
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
            onCancel={() => void navigate({ to: '/machines/$id', params: { id } })}
          />
        </div>
      </div>
    </div>
  );
}
