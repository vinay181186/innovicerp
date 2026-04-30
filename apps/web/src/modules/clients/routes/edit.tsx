import type { CreateClientInput, UpdateClientInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
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

function ClientNewPage() {
  const navigate = useNavigate();
  const create = useCreateClient();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: CreateClientInput) => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync(values);
      await navigate({ to: '/clients/$id', params: { id: created.id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create client');
    }
  };

  return (
    <main className="container max-w-3xl py-10">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/clients">
            <ArrowLeft />
            Back to clients
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>New client</CardTitle>
            <CardDescription>Create a master record for a customer.</CardDescription>
          </CardHeader>
          <CardContent>
            <ClientForm
              mode="create"
              onSubmit={onSubmit}
              submitError={submitError}
              onCancel={() => void navigate({ to: '/clients' })}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function ClientEditPage() {
  const { id } = clientEditRoute.useParams();
  const navigate = useNavigate();
  const { data: client, isLoading, isError, error } = useClient(id);
  const update = useUpdateClient(id);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: UpdateClientInput) => {
    setSubmitError(null);
    try {
      await update.mutateAsync(values);
      await navigate({ to: '/clients/$id', params: { id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update client');
    }
  };

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

  return (
    <main className="container max-w-3xl py-10">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/clients/$id" params={{ id }}>
            <ArrowLeft />
            Back to client
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardDescription className="font-mono">{client.code}</CardDescription>
            <CardTitle>Edit client</CardTitle>
          </CardHeader>
          <CardContent>
            <ClientForm
              mode="edit"
              client={client}
              onSubmit={onSubmit}
              submitError={submitError}
              onCancel={() => void navigate({ to: '/clients/$id', params: { id } })}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
