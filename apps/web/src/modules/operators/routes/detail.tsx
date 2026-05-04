import type { Operator } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useOperator, useSoftDeleteOperator } from '../api';

export const operatorDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'operators/$id',
  component: OperatorDetailPage,
});

function OperatorDetailPage() {
  const { id } = operatorDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: operator, isLoading, isError, error } = useOperator(id);
  const softDelete = useSoftDeleteOperator();
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  const onDelete = () => {
    softDelete.mutate(operator.id, {
      onSuccess: () => {
        void navigate({ to: '/operators', replace: true });
      },
    });
  };

  return (
    <main className="container max-w-3xl py-10">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Button asChild variant="ghost" size="sm">
            <Link to="/operators">
              <ArrowLeft />
              Back
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/operators/$id/edit" params={{ id: operator.id }}>
                <Pencil />
                Edit
              </Link>
            </Button>
            {confirmDelete ? (
              <>
                <span className="text-sm text-muted-foreground">Delete this operator?</span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={onDelete}
                  disabled={softDelete.isPending}
                >
                  {softDelete.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  Confirm
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                  disabled={softDelete.isPending}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 />
                Delete
              </Button>
            )}
          </div>
        </div>

        {softDelete.isError ? (
          <p className="text-sm text-destructive">
            {softDelete.error instanceof Error
              ? softDelete.error.message
              : 'Failed to delete operator.'}
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <CardDescription className="font-mono">{operator.code}</CardDescription>
            <CardTitle>{operator.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailGrid operator={operator} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function DetailGrid(props: { operator: Operator }) {
  const { operator } = props;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm md:grid-cols-2">
      <Pair label="Status" value={operator.isActive ? 'Active' : 'Inactive'} />
      <Pair label="Department" value={operator.department ?? '—'} />
      <Pair label="Linked user" value={operator.userId ?? '—'} />
      <div className="md:col-span-2">
        <dt className="text-xs uppercase tracking-wide text-muted-foreground">Skills / Machines</dt>
        <dd className="mt-1 whitespace-pre-wrap">{operator.skills ?? '—'}</dd>
      </div>
    </dl>
  );
}

function Pair(props: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{props.label}</dt>
      <dd className="mt-1 font-medium">{props.value}</dd>
    </div>
  );
}
