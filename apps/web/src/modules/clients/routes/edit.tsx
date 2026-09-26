// Client new + edit routes (UI-003-03). Both wrap <ClientForm> in the
// Innovic panel chrome with a back link header.

import type { CreateClientInput, UpdateClientInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useExitConfirm } from '@/lib/exit-guard';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
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
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'client_create');
  const goBack = useCallback(() => void navigate({ to: '/clients' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });

  const onSubmit = async (values: CreateClientInput): Promise<void> => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync(values);
      exit.leave(
        () => void navigate({ to: '/clients/$id', params: { id: created.id }, replace: true }),
      );
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save Customer. Try again.');
    }
  };

  if (eff && !perms.entry) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        ⛔ You do not have create access to Customer Master. Ask an admin for L2 Data Entry or above
        in Sales.
      </div>
    );
  }

  return (
    <div>
      {exit.dialog}
      <ClientForm
        mode="create"
        header={{
          title: 'New Customer',
          subtitle: 'Create a master record for a customer.',
          backLabel: 'Back to Customer Master',
        }}
        onSubmit={onSubmit}
        submitError={submitError}
        onCancel={() => exit.leave(goBack)}
      />
    </div>
  );
}

function ClientEditPage(): React.JSX.Element {
  const { id } = clientEditRoute.useParams();
  const navigate = useNavigate();
  const { data: client, isLoading, isError, error } = useClient(id);
  const update = useUpdateClient(id);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'client_create');

  const goBack = useCallback(
    () => void navigate({ to: '/clients/$id', params: { id } }),
    [navigate, id],
  );
  const exit = useExitConfirm({ onExit: goBack });

  const onSubmit = async (values: UpdateClientInput): Promise<void> => {
    setSubmitError(null);
    try {
      await update.mutateAsync(values);
      exit.leave(() => void navigate({ to: '/clients/$id', params: { id }, replace: true }));
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save changes. Try again.');
    }
  };

  if (eff && !perms.edit) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        ⛔ You do not have edit access to Customer Master. Ask an admin for L2 Data Entry or above
        in Sales.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading customer…
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
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Customer not found'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {exit.dialog}
      <ClientForm
        mode="edit"
        header={{
          title: 'Edit Customer',
          subtitle: (
            <>
              <span className="td-code">{client.code}</span> · {client.name}
            </>
          ),
          backLabel: 'Back to customer',
        }}
        client={client}
        onSubmit={onSubmit}
        submitError={submitError}
        onCancel={() => exit.leave(goBack)}
      />
    </div>
  );
}
