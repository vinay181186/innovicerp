// Client detail page (UI-003-03). Mirrors items/routes/detail.tsx pattern.

import type { Client } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useClient, useSoftDeleteClient } from '../api';

export const clientDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'clients/$id',
  component: ClientDetailPage,
});

function ClientDetailPage(): React.JSX.Element {
  const { id } = clientDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: client, isLoading, isError, error } = useClient(id);
  const { data: me } = useSession();
  const softDelete = useSoftDeleteClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading client…
      </div>
    );
  }

  if (isError || !client) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/clients" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Client not found'}
          </div>
        </div>
      </div>
    );
  }

  const onDelete = (): void => {
    softDelete.mutate(client.id, {
      onSuccess: () => {
        void navigate({ to: '/clients', replace: true });
      },
    });
  };

  const canEdit = me?.role === 'admin' || me?.role === 'manager';
  const isAdmin = me?.role === 'admin';

  return (
    <div>
      <Link to="/clients" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Client Master
      </Link>

      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div
              className="td-code"
              style={{ color: 'var(--cyan)', fontSize: 16, fontWeight: 700 }}
            >
              {client.code}
            </div>
            <div className="panel-title" style={{ marginTop: 2 }}>
              {client.name}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {canEdit ? (
              <Link
                to="/clients/$id/edit"
                params={{ id: client.id }}
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
                : 'Failed to delete client.'}
            </div>
          ) : null}
          <DetailGrid client={client} />
        </div>
      </div>
    </div>
  );
}

function DetailGrid(props: { client: Client }): React.JSX.Element {
  const { client } = props;
  return (
    <div className="form-grid">
      <Pair
        label="Status"
        value={
          <span className={`badge ${client.isActive ? 'b-green' : 'b-grey'}`}>
            {client.isActive ? 'active' : 'inactive'}
          </span>
        }
      />
      <Pair label="Contact person" value={client.contactPerson ?? '—'} />
      <Pair label="Email" value={client.email ?? '—'} />
      <Pair label="Phone" value={client.phone ?? '—'} />
      <Pair label="GST number" value={client.gstNumber ?? '—'} />
      <Pair label="Pincode" value={client.pincode ?? '—'} />
      <Pair label="City" value={client.city ?? '—'} />
      <Pair label="State" value={client.state ?? '—'} />
      <div className="form-grp form-full">
        <span className="form-label">Address</span>
        <div style={{ whiteSpace: 'pre-wrap' }}>{client.addressLine1 ?? '—'}</div>
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
