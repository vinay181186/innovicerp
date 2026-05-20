// Operator new + edit routes (UI-003-03).

import type { CreateOperatorInput, UpdateOperatorInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
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

  const onSubmit = async (values: CreateOperatorInput): Promise<void> => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync(values);
      await navigate({ to: '/operators/$id', params: { id: created.id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create operator');
    }
  };

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
  const { data: operator, isLoading, isError, error } = useOperator(id);
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
