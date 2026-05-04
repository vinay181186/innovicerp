import type { CreateOperatorInput, UpdateOperatorInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

function OperatorNewPage() {
  const navigate = useNavigate();
  const create = useCreateOperator();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: CreateOperatorInput) => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync(values);
      await navigate({ to: '/operators/$id', params: { id: created.id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create operator');
    }
  };

  return (
    <main className="container max-w-3xl py-10">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/operators">
            <ArrowLeft />
            Back to operators
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>New operator</CardTitle>
            <CardDescription>Create a master record for a shop-floor worker.</CardDescription>
          </CardHeader>
          <CardContent>
            <OperatorForm
              mode="create"
              onSubmit={onSubmit}
              submitError={submitError}
              onCancel={() => void navigate({ to: '/operators' })}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function OperatorEditPage() {
  const { id } = operatorEditRoute.useParams();
  const navigate = useNavigate();
  const { data: operator, isLoading, isError, error } = useOperator(id);
  const update = useUpdateOperator(id);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: UpdateOperatorInput) => {
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
      <main className="container max-w-3xl py-10">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading operator…
        </div>
      </main>
    );
  }

  if (isError || !operator) {
    return (
      <main className="container max-w-3xl py-10">
        <Card>
          <CardHeader>
            <CardTitle>Operator not found</CardTitle>
            <CardDescription>
              {error instanceof Error ? error.message : 'This operator could not be loaded.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/operators">
                <ArrowLeft />
                Back to operators
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="container max-w-3xl py-10">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/operators/$id" params={{ id }}>
            <ArrowLeft />
            Back to operator
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardDescription className="font-mono">{operator.code}</CardDescription>
            <CardTitle>Edit operator</CardTitle>
          </CardHeader>
          <CardContent>
            <OperatorForm
              mode="edit"
              operator={operator}
              onSubmit={onSubmit}
              submitError={submitError}
              onCancel={() => void navigate({ to: '/operators/$id', params: { id } })}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
