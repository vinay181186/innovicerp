import type { UpdateNcRegisterInput } from '@innovic/shared';
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
import { useNcRegister, useUpdateNcRegister } from '../api';
import { NcRegisterForm } from '../components/nc-register-form';

export const ncRegisterEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'nc-register/$id/edit',
  component: NcRegisterEditPage,
});

function NcRegisterEditPage() {
  const { id } = ncRegisterEditRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useNcRegister(id);
  const update = useUpdateNcRegister(id);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <main className="container max-w-3xl py-10">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading NC…
        </div>
      </main>
    );
  }
  if (isError || !detail) {
    return (
      <main className="container max-w-3xl py-10">
        <Card>
          <CardHeader>
            <CardTitle>NC not found</CardTitle>
            <CardDescription>
              {error instanceof Error ? error.message : 'This NC could not be loaded.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/nc-register">
                <ArrowLeft />
                Back to NC register
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (detail.status !== 'pending') {
    return (
      <main className="container max-w-3xl py-10">
        <Card>
          <CardHeader>
            <CardTitle>Cannot edit a {detail.status.replaceAll('_', ' ')} NC</CardTitle>
            <CardDescription>
              Disposed and closed NCs are permanent records. Disposition workflow lands in T-040b.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/nc-register/$id" params={{ id: detail.id }}>
                <ArrowLeft />
                Back to {detail.code}
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
          <Link to="/nc-register/$id" params={{ id: detail.id }}>
            <ArrowLeft />
            Back to {detail.code}
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Edit NC {detail.code}</h1>
          <p className="text-sm text-muted-foreground">
            Editable while status is <span className="font-mono">pending</span> — date, reason
            category, defect description, reporter only.
          </p>
        </div>
        <NcRegisterForm
          mode="edit"
          detail={detail}
          submitError={submitError}
          submitLabel="Save changes"
          onCancel={() => void navigate({ to: '/nc-register/$id', params: { id: detail.id } })}
          onSubmit={async (values: UpdateNcRegisterInput) => {
            setSubmitError(null);
            try {
              await update.mutateAsync(values);
              void navigate({ to: '/nc-register/$id', params: { id: detail.id } });
            } catch (e) {
              setSubmitError(e instanceof Error ? e.message : 'Failed to save changes.');
            }
          }}
        />
      </div>
    </main>
  );
}
