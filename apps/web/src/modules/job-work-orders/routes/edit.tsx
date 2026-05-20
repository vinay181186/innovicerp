// JW new + edit routes (UI-003-04).

import type { CreateJobWorkOrderInput, UpdateJobWorkOrderInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateJobWorkOrder, useJobWorkOrder, useUpdateJobWorkOrder } from '../api';
import { JobWorkOrderForm } from '../components/job-work-order-form';

export const jobWorkOrderNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-work-orders/new',
  component: JobWorkOrderNewPage,
});

export const jobWorkOrderEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-work-orders/$id/edit',
  component: JobWorkOrderEditPage,
});

function JobWorkOrderNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const create = useCreateJobWorkOrder();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: CreateJobWorkOrderInput): Promise<void> => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync(values);
      await navigate({ to: '/job-work-orders/$id', params: { id: created.id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create job-work order');
    }
  };

  return (
    <div>
      <Link to="/job-work-orders" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to JW Master
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="panel-title">+ New JW Order</div>
            <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
              Customer-supplied raw material → we machine and deliver.
            </div>
          </div>
        </div>
        <div className="panel-body">
          <JobWorkOrderForm
            mode="create"
            onSubmit={onSubmit}
            submitError={submitError}
            onCancel={() => void navigate({ to: '/job-work-orders' })}
          />
        </div>
      </div>
    </div>
  );
}

function JobWorkOrderEditPage(): React.JSX.Element {
  const { id } = jobWorkOrderEditRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useJobWorkOrder(id);
  const update = useUpdateJobWorkOrder(id);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: UpdateJobWorkOrderInput): Promise<void> => {
    setSubmitError(null);
    try {
      await update.mutateAsync(values);
      await navigate({ to: '/job-work-orders/$id', params: { id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update job-work order');
    }
  };

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading job-work order…
      </div>
    );
  }

  if (isError || !detail) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/job-work-orders" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Job-work order not found'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link
        to="/job-work-orders/$id"
        params={{ id }}
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 10 }}
      >
        <ArrowLeft size={14} /> Back to JW
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="td-code" style={{ color: 'var(--cyan)', fontSize: 14, fontWeight: 700 }}>
              {detail.code}
            </div>
            <div className="panel-title" style={{ marginTop: 2 }}>
              Edit Job-Work Order
            </div>
          </div>
        </div>
        <div className="panel-body">
          <JobWorkOrderForm
            mode="edit"
            detail={detail}
            onSubmit={onSubmit}
            submitError={submitError}
            onCancel={() => void navigate({ to: '/job-work-orders/$id', params: { id } })}
          />
        </div>
      </div>
    </div>
  );
}
