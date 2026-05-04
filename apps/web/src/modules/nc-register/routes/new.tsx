import type { CreateNcRegisterInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateNcRegister } from '../api';
import { NcRegisterForm } from '../components/nc-register-form';

export const ncRegisterNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'nc-register/new',
  component: NcRegisterNewPage,
});

function NcRegisterNewPage() {
  const navigate = useNavigate();
  const create = useCreateNcRegister();
  const [submitError, setSubmitError] = useState<string | null>(null);

  return (
    <main className="container max-w-3xl py-10">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/nc-register">
            <ArrowLeft />
            Back to NC register
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Report NC</h1>
          <p className="text-sm text-muted-foreground">
            Status starts as <span className="font-mono">pending</span> until disposition (T-040b).
          </p>
        </div>
        <NcRegisterForm
          mode="create"
          submitError={submitError}
          submitLabel="Report NC"
          onCancel={() => void navigate({ to: '/nc-register' })}
          onSubmit={async (values: CreateNcRegisterInput) => {
            setSubmitError(null);
            try {
              const created = await create.mutateAsync(values);
              void navigate({ to: '/nc-register/$id', params: { id: created.id } });
            } catch (e) {
              setSubmitError(e instanceof Error ? e.message : 'Failed to report NC.');
            }
          }}
        />
      </div>
    </main>
  );
}
