// Operator new + edit routes (UI-003-03).

import type { CreateOperatorInput, UpdateOperatorInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateOperator, useOperator, useUpdateOperator } from '../api';
import { OperatorForm } from '../components/operator-form';

export const operatorNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'operators/new',
  component: OperatorNewPage,
});

export const operatorEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'operators/$id/edit',
  component: OperatorEditPage,
});

function OperatorNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const create = useCreateOperator();
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Tier gate (operator_create sits in Production). The list's Add button is
  // hidden without entry rights, but this URL-reachable form had no gate of its
  // own. The server refuses the save either way; this stops the form appearing.
  const { data: eff, isLoading: accessLoading } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'operator_create');

  const onSubmit = async (values: CreateOperatorInput): Promise<void> => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync(values);
      await navigate({ to: '/operators/$id', params: { id: created.id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create operator');
    }
  };

  if (accessLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (!perms.entry) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/operators" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back to Operator Master
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--amber)' }}>
            ⛔ You do not have create access to Operator Master. Ask an admin for L2 Data Entry or
            above in Production.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link to="/operators" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Operator Master
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="panel-title">+ Add Operator</div>
            <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
              Create a master record for a shop-floor worker.
            </div>
          </div>
        </div>
        <div className="panel-body">
          <OperatorForm
            mode="create"
            onSubmit={onSubmit}
            submitError={submitError}
            onCancel={() => void navigate({ to: '/operators' })}
          />
        </div>
      </div>
    </div>
  );
}

function OperatorEditPage(): React.JSX.Element {
  const { id } = operatorEditRoute.useParams();
  const navigate = useNavigate();
  // Tier gate — editing a saved operator needs `edit` (L3 Editor and up).
  const { data: eff, isLoading: accessLoading } = useMyAccess();
  const canEdit = effectiveFormPerms(eff, 'operator_create').edit;
  const { data: operator, isLoading, isError, error } = useOperator(canEdit ? id : undefined);
  const update = useUpdateOperator(id);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: UpdateOperatorInput): Promise<void> => {
    setSubmitError(null);
    try {
      await update.mutateAsync(values);
      await navigate({ to: '/operators/$id', params: { id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update operator');
    }
  };

  if (accessLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (!canEdit) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/operators" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back to Operator Master
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--amber)' }}>
            ⛔ You do not have edit access to Operator Master. Ask an admin for L3 Editor or above in
            Production.
          </div>
        </div>
      </div>
    );
  }

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

  return (
    <div>
      <Link
        to="/operators/$id"
        params={{ id }}
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 10 }}
      >
        <ArrowLeft size={14} /> Back to operator
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div
              className="td-code"
              style={{ color: 'var(--cyan)', fontSize: 14, fontWeight: 700 }}
            >
              {operator.code}
            </div>
            <div className="panel-title" style={{ marginTop: 2 }}>
              Edit Operator
            </div>
          </div>
        </div>
        <div className="panel-body">
          <OperatorForm
            mode="edit"
            operator={operator}
            onSubmit={onSubmit}
            submitError={submitError}
            onCancel={() => void navigate({ to: '/operators/$id', params: { id } })}
          />
        </div>
      </div>
    </div>
  );
}
