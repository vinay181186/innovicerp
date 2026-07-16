// Client new + edit routes (UI-003-03). Both wrap <ClientForm> in the
// Innovic panel chrome with a back link header.

import type { CreateClientInput, UpdateClientInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useClient, useCreateClient, useUpdateClient } from '../api';
import { ClientForm } from '../components/client-form';

export const clientNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'clients/new',
  component: ClientNewPage,
});

export const clientEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'clients/$id/edit',
  component: ClientEditPage,
});

function ClientNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const create = useCreateClient();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: CreateClientInput): Promise<void> => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync(values);
      await navigate({ to: '/clients/$id', params: { id: created.id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create client');
    }
  };

  return (
    <div>
      <Link to="/clients" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Client Master
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="panel-title">New Client</div>
            <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
              Create a master record for a customer.
            </div>
          </div>
        </div>
        <div className="panel-body">
          <ClientForm
            mode="create"
            onSubmit={onSubmit}
            submitError={submitError}
            onCancel={() => void navigate({ to: '/clients' })}
          />
        </div>
      </div>
    </div>
  );
}

function ClientEditPage(): React.JSX.Element {
  const { id } = clientEditRoute.useParams();
  const navigate = useNavigate();
  const { data: client, isLoading, isError, error } = useClient(id);
  const update = useUpdateClient(id);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: UpdateClientInput): Promise<void> => {
    setSubmitError(null);
    try {
      await update.mutateAsync(values);
      await navigate({ to: '/clients/$id', params: { id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update client');
    }
  };

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

  return (
    <div>
      <Link
        to="/clients/$id"
        params={{ id }}
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 10 }}
      >
        <ArrowLeft size={14} /> Back to client
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div
              className="td-code"
              style={{ color: 'var(--cyan)', fontSize: 14, fontWeight: 700 }}
            >
              {client.code}
            </div>
            <div className="panel-title" style={{ marginTop: 2 }}>
              Edit Client — {client.name}
            </div>
          </div>
        </div>
        <div className="panel-body">
          <ClientForm
            mode="edit"
            client={client}
            onSubmit={onSubmit}
            submitError={submitError}
            onCancel={() => void navigate({ to: '/clients/$id', params: { id } })}
          />
        </div>
      </div>
    </div>
  );
}
