// Machine detail page (UI-003-03).

import type { Machine } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useMachine, useSoftDeleteMachine } from '../api';

export const machineDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'machines/$id',
  component: MachineDetailPage,
});

function statusBadgeClass(status: string): string {
  if (status === 'Running') return 'b-blue';
  if (status === 'Idle') return 'b-grey';
  if (status === 'Maintenance') return 'b-amber';
  if (status === 'Down') return 'b-red';
  return 'b-grey';
}

function MachineDetailPage(): React.JSX.Element {
  const { id } = machineDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: machine, isLoading, isError, error } = useMachine(id);
  const { data: me } = useSession();
  const softDelete = useSoftDeleteMachine();
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  const onDelete = (): void => {
    softDelete.mutate(machine.id, {
      onSuccess: () => {
        void navigate({ to: '/machines', replace: true });
      },
    });
  };

  const canEdit = me?.role === 'admin' || me?.role === 'manager';
  const isAdmin = me?.role === 'admin';

  return (
    <div>
      <Link to="/machines" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Machine Master
      </Link>

      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div
              className="td-code"
              style={{ color: 'var(--cyan)', fontSize: 16, fontWeight: 700 }}
            >
              {machine.code}
            </div>
            <div className="panel-title" style={{ marginTop: 2 }}>
              {machine.name}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {canEdit ? (
              <Link
                to="/machines/$id/edit"
                params={{ id: machine.id }}
                className="btn btn-ghost btn-sm"
              >
                <Pencil size={13} /> Edit
              </Link>
            ) : null}
            {isAdmin ? (
              confirmDelete ? (
                <>
                  <span className="text3" style={{ fontSize: 12, alignSelf: 'center' }}>
                    Delete?
                  </span>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={onDelete}
                    disabled={softDelete.isPending}
                  >
                    {softDelete.isPending ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Trash2 size={13} />
                    )}
                    Confirm
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setConfirmDelete(false)}
                    disabled={softDelete.isPending}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={13} /> Delete
                </button>
              )
            ) : null}
          </div>
        </div>
        <div className="panel-body">
          {softDelete.isError ? (
            <div
              style={{
                color: 'var(--red)',
                background: 'var(--red3)',
                border: '1px solid #fca5a5',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 12,
                marginBottom: 10,
              }}
            >
              {softDelete.error instanceof Error
                ? softDelete.error.message
                : 'Failed to delete machine.'}
            </div>
          ) : null}
          <DetailGrid machine={machine} />
        </div>
      </div>
    </div>
  );
}

function DetailGrid(props: { machine: Machine }): React.JSX.Element {
  const { machine } = props;
  return (
    <div className="form-grid">
      <Pair
        label="Status"
        value={
          <span className={`badge ${statusBadgeClass(machine.status)}`}>{machine.status}</span>
        }
      />
      <Pair label="Machine type" value={machine.machineType ?? '—'} />
      <Pair
        label="Capacity / shift"
        value={machine.capacityPerShift !== null ? `${machine.capacityPerShift} h` : '—'}
      />
      <Pair label="Shifts / day" value={String(machine.shiftsPerDay)} />
    </div>
  );
}

function Pair(props: { label: string; value: string | React.ReactNode }): React.JSX.Element {
  return (
    <div className="form-grp">
      <span className="form-label">{props.label}</span>
      <div style={{ fontWeight: 600 }}>{props.value}</div>
    </div>
  );
}
