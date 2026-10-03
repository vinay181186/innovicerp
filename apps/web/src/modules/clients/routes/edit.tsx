// Client new + edit routes (UI-003-03). Both wrap <ClientForm> in the
// Innovic panel chrome with a back link header.

import type { CreateClientInput, UpdateClientInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useExitConfirm } from '@/lib/exit-guard';
import { useOpenedVersion } from '@/lib/use-opened-version';
import { useSaveKey } from '@/lib/use-save-key';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { isStagedResult } from '@/modules/document-edits/api';
import { Banner } from '@/ui/feedback';
import { type ServerFieldErrors, serverFieldErrorsOf } from '@/modules/settings/master-rules-ui';
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
  const saveKey = useSaveKey();
  const create = useCreateClient(saveKey);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [serverFieldErrors, setServerFieldErrors] = useState<ServerFieldErrors | null>(null);
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'client_create');
  const goBack = useCallback(() => void navigate({ to: '/clients' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });

  const onSubmit = async (values: CreateClientInput): Promise<void> => {
    setSubmitError(null);
    setServerFieldErrors(null);
    try {
      const created = await create.mutateAsync(values);
      exit.leave(
        () => void navigate({ to: '/clients/$id', params: { id: created.id }, replace: true }),
      );
    } catch (err) {
      setServerFieldErrors(serverFieldErrorsOf(err));
      setSubmitError(err instanceof Error ? err.message : 'Could not save Customer. Try again.');
    }
  };

  if (eff && !perms.entry) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to create Customers. Ask an admin.
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
          backLabel: 'Back to Customer Master',
        }}
        onSubmit={onSubmit}
        submitError={submitError}
        serverFieldErrors={serverFieldErrors}
        onCancel={() => exit.leave(goBack)}
      />
    </div>
  );
}

function ClientEditPage(): React.JSX.Element {
  const { id } = clientEditRoute.useParams();
  const navigate = useNavigate();
  const { data: client, isLoading, isError, error } = useClient(id);
  const saveKey = useSaveKey();
  const update = useUpdateClient(id, saveKey);
  // R5: the version this form was opened from — a save after someone else
  // changed the client is refused (409 edit_conflict) instead of overwriting it.
  const opened = useOpenedVersion(client?.updatedAt);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [serverFieldErrors, setServerFieldErrors] = useState<ServerFieldErrors | null>(null);
  // ADR-202 — set when an edit to a LIVE customer is staged for approval instead of
  // applied; the neutral "Sent for approval" banner shows it.
  const [stagedNotice, setStagedNotice] = useState<string | null>(null);
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'client_create');

  const goBack = useCallback(
    () => void navigate({ to: '/clients/$id', params: { id } }),
    [navigate, id],
  );
  const exit = useExitConfirm({ onExit: goBack });

  const onSubmit = async (values: UpdateClientInput): Promise<void> => {
    setSubmitError(null);
    setServerFieldErrors(null);
    try {
      const saved = await update.mutateAsync({ ...values, expectedUpdatedAt: opened.expected() });
      if (isStagedResult(saved)) {
        // The edit-approval gate is on and this customer is live: nothing was changed
        // on the customer — the edit is now waiting for approval. Say so, then return
        // to the customer (its fields now carry the pending-change chip).
        setStagedNotice('Sent for approval — your changes will apply once an approver signs off.');
        exit.leave(() => void navigate({ to: '/clients/$id', params: { id }, replace: true }));
        return;
      }
      opened.saved(saved.updatedAt);
      exit.leave(() => void navigate({ to: '/clients/$id', params: { id }, replace: true }));
    } catch (err) {
      setServerFieldErrors(serverFieldErrorsOf(err));
      setSubmitError(err instanceof Error ? err.message : 'Could not save changes. Try again.');
    }
  };

  if (eff && !perms.edit) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to edit Customers. Ask an admin.
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
            {error instanceof Error ? error.message : 'Customer not found. Refresh the page.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {exit.dialog}
      {stagedNotice ? (
        <Banner tone="success" role="status">
          {stagedNotice}
        </Banner>
      ) : null}
      <ClientForm
        mode="edit"
        header={{
          title: 'Edit Customer',
          subtitle: (
            <>
              <span className="td-code">{client.code}</span> · {client.name}
            </>
          ),
          backLabel: 'Back to Customer',
        }}
        client={client}
        onSubmit={onSubmit}
        submitError={submitError}
        serverFieldErrors={serverFieldErrors}
        onCancel={() => exit.leave(goBack)}
      />
    </div>
  );
}
