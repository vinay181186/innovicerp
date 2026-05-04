import type { CreateJobWorkOrderInput, UpdateJobWorkOrderInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

function JobWorkOrderNewPage() {
  const navigate = useNavigate();
  const create = useCreateJobWorkOrder();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: CreateJobWorkOrderInput) => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync(values);
      await navigate({
        to: '/job-work-orders/$id',
        params: { id: created.id },
        replace: true,
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create job-work order');
    }
  };

  return (
    <main className="container max-w-5xl py-10">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/job-work-orders">
            <ArrowLeft />
            Back to job-work orders
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>New job-work order</CardTitle>
            <CardDescription>
              Customer-supplied raw material → we machine and deliver.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <JobWorkOrderForm
              mode="create"
              onSubmit={onSubmit}
              submitError={submitError}
              onCancel={() => void navigate({ to: '/job-work-orders' })}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function JobWorkOrderEditPage() {
  const { id } = jobWorkOrderEditRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useJobWorkOrder(id);
  const update = useUpdateJobWorkOrder(id);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: UpdateJobWorkOrderInput) => {
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
      <main className="container max-w-5xl py-10">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading job-work order…
        </div>
      </main>
    );
  }

  if (isError || !detail) {
    return (
      <main className="container max-w-5xl py-10">
        <Card>
          <CardHeader>
            <CardTitle>Job-work order not found</CardTitle>
            <CardDescription>
              {error instanceof Error ? error.message : 'This job-work order could not be loaded.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/job-work-orders">
                <ArrowLeft />
                Back to job-work orders
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="container max-w-5xl py-10">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/job-work-orders/$id" params={{ id }}>
            <ArrowLeft />
            Back to JW
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardDescription className="font-mono">{detail.code}</CardDescription>
            <CardTitle>Edit job-work order</CardTitle>
          </CardHeader>
          <CardContent>
            <JobWorkOrderForm
              mode="edit"
              detail={detail}
              onSubmit={onSubmit}
              submitError={submitError}
              onCancel={() => void navigate({ to: '/job-work-orders/$id', params: { id } })}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
