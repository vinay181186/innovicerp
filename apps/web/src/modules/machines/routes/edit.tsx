import type { CreateMachineInput, UpdateMachineInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateMachine, useMachine, useUpdateMachine } from '../api';
import { MachineForm } from '../components/machine-form';

export const machineNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'machines/new',
  component: MachineNewPage,
});

export const machineEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'machines/$id/edit',
  component: MachineEditPage,
});

function MachineNewPage() {
  const navigate = useNavigate();
  const create = useCreateMachine();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: CreateMachineInput) => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync(values);
      await navigate({ to: '/machines/$id', params: { id: created.id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create machine');
    }
  };

  return (
    <main className="container max-w-3xl py-10">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/machines">
            <ArrowLeft />
            Back to machines
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>New machine</CardTitle>
            <CardDescription>Create a master record for shop-floor equipment.</CardDescription>
          </CardHeader>
          <CardContent>
            <MachineForm
              mode="create"
              onSubmit={onSubmit}
              submitError={submitError}
              onCancel={() => void navigate({ to: '/machines' })}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function MachineEditPage() {
  const { id } = machineEditRoute.useParams();
  const navigate = useNavigate();
  const { data: machine, isLoading, isError, error } = useMachine(id);
  const update = useUpdateMachine(id);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: UpdateMachineInput) => {
    setSubmitError(null);
    try {
      await update.mutateAsync(values);
      await navigate({ to: '/machines/$id', params: { id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update machine');
    }
  };

  if (isLoading) {
    return (
      <main className="container max-w-3xl py-10">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading machine…
        </div>
      </main>
    );
  }

  if (isError || !machine) {
    return (
      <main className="container max-w-3xl py-10">
        <Card>
          <CardHeader>
            <CardTitle>Machine not found</CardTitle>
            <CardDescription>
              {error instanceof Error ? error.message : 'This machine could not be loaded.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/machines">
                <ArrowLeft />
                Back to machines
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
          <Link to="/machines/$id" params={{ id }}>
            <ArrowLeft />
            Back to machine
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardDescription className="font-mono">{machine.code}</CardDescription>
            <CardTitle>Edit machine</CardTitle>
          </CardHeader>
          <CardContent>
            <MachineForm
              mode="edit"
              machine={machine}
              onSubmit={onSubmit}
              submitError={submitError}
              onCancel={() => void navigate({ to: '/machines/$id', params: { id } })}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
