// Operator detail page (UI-003-03).

import type { Operator } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useOperator, useSoftDeleteOperator } from '../api';

export const operatorDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'operators/$id',
  component: OperatorDetailPage,
});

function OperatorDetailPage(): React.JSX.Element {
  const { id } = operatorDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: operator, isLoading, isError, error } = useOperator(id);
  const { data: me } = useSession();
  const softDelete = useSoftDeleteOperator();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading operator…
      </div>
    );
  }

  if (isError || !operator) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/operators" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Operator not found'}
          </div>
        </div>
      </div>
    );
  }

  const onDelete = (): void => {
    softDelete.mutate(operator.id, {
      onSuccess: () => {
        void navigate({ to: '/operators', replace: true });
      },
    });
  };

  const canEdit = me?.role === 'admin' || me?.role === 'manager';
  const isAdmin = me?.role === 'admin';

  return (
    <div>
      <Link to="/operators" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Operator Master
      </Link>

      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div
              className="td-code"
              style={{ color: 'var(--cyan)', fontSize: 16, fontWeight: 700 }}
            >
              {operator.code}
            </div>
            <div className="panel-title" style={{ marginTop: 2 }}>
              {operator.name}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {canEdit ? (
              <Link
                to="/operators/$id/edit"
                params={{ id: operator.id }}
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
                : 'Failed to delete operator.'}
            </div>
          ) : null}
          <DetailGrid operator={operator} />
        </div>
      </div>
    </div>
  );
}

function DetailGrid(props: { operator: Operator }): React.JSX.Element {
  const { operator } = props;
  return (
    <div className="form-grid">
      <Pair
        label="Status"
        value={
          <span className={`badge ${operator.isActive ? 'b-green' : 'b-grey'}`}>
            {operator.isActive ? 'active' : 'inactive'}
          </span>
        }
      />
      <Pair label="Department" value={operator.department ?? '—'} />
      <Pair label="Linked user" value={operator.userId ?? '—'} />
      <div className="form-grp form-full">
        <span className="form-label">Skills / Machines</span>
        <div style={{ whiteSpace: 'pre-wrap' }}>{operator.skills ?? '—'}</div>
      </div>
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
