import type { Client } from '@innovic/shared';
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
import { useClient, useSoftDeleteClient } from '../api';

export const clientDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'clients/$id',
  component: ClientDetailPage,
});

function ClientDetailPage() {
  const { id } = clientDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: client, isLoading, isError, error } = useClient(id);
  const softDelete = useSoftDeleteClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isLoading) {
    return (
      <main className="container max-w-3xl py-10">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading client…
        </div>
      </main>
    );
  }

  if (isError || !client) {
    return (
      <main className="container max-w-3xl py-10">
        <Card>
          <CardHeader>
            <CardTitle>Client not found</CardTitle>
            <CardDescription>
              {error instanceof Error ? error.message : 'This client could not be loaded.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/clients">
                <ArrowLeft />
                Back to clients
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const onDelete = () => {
    softDelete.mutate(client.id, {
      onSuccess: () => {
        void navigate({ to: '/clients', replace: true });
      },
    });
  };

  return (
    <main className="container max-w-3xl py-10">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Button asChild variant="ghost" size="sm">
            <Link to="/clients">
              <ArrowLeft />
              Back
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/clients/$id/edit" params={{ id: client.id }}>
                <Pencil />
                Edit
              </Link>
            </Button>
            {confirmDelete ? (
              <>
                <span className="text-sm text-muted-foreground">Delete this client?</span>
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
              : 'Failed to delete client.'}
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <CardDescription className="font-mono">{client.code}</CardDescription>
            <CardTitle>{client.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailGrid client={client} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function DetailGrid(props: { client: Client }) {
  const { client } = props;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm md:grid-cols-2">
      <Pair label="Status" value={client.isActive ? 'Active' : 'Inactive'} />
      <Pair label="Contact person" value={client.contactPerson ?? '—'} />
      <Pair label="Email" value={client.email ?? '—'} />
      <Pair label="Phone" value={client.phone ?? '—'} />
      <Pair label="GST number" value={client.gstNumber ?? '—'} />
      <Pair label="Pincode" value={client.pincode ?? '—'} />
      <Pair label="City" value={client.city ?? '—'} />
      <Pair label="State" value={client.state ?? '—'} />
      <div className="md:col-span-2">
        <dt className="text-xs uppercase tracking-wide text-muted-foreground">Address</dt>
        <dd className="mt-1 whitespace-pre-wrap">{client.addressLine1 ?? '—'}</dd>
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
