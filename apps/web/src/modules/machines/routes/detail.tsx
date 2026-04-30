import type { Machine } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useMachine, useSoftDeleteMachine } from '../api';

export const machineDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'machines/$id',
  component: MachineDetailPage,
});

function MachineDetailPage() {
  const { id } = machineDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: machine, isLoading, isError, error } = useMachine(id);
  const softDelete = useSoftDeleteMachine();
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  const onDelete = () => {
    softDelete.mutate(machine.id, {
      onSuccess: () => {
        void navigate({ to: '/machines', replace: true });
      },
    });
  };

  return (
    <main className="container max-w-3xl py-10">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Button asChild variant="ghost" size="sm">
            <Link to="/machines">
              <ArrowLeft />
              Back
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/machines/$id/edit" params={{ id: machine.id }}>
                <Pencil />
                Edit
              </Link>
            </Button>
            {confirmDelete ? (
              <>
                <span className="text-sm text-muted-foreground">Delete this machine?</span>
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
              : 'Failed to delete machine.'}
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <CardDescription className="font-mono">{machine.code}</CardDescription>
            <CardTitle>{machine.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailGrid machine={machine} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function DetailGrid(props: { machine: Machine }) {
  const { machine } = props;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm md:grid-cols-2">
      <Pair label="Status" value={machine.status} />
      <Pair label="Machine type" value={machine.machineType ?? '—'} />
      <Pair
        label="Capacity / shift"
        value={machine.capacityPerShift !== null ? String(machine.capacityPerShift) : '—'}
      />
      <Pair label="Shifts / day" value={String(machine.shiftsPerDay)} />
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
