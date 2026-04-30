import type { CreateVendorInput, UpdateVendorInput } from '@innovic/shared';
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
import { useCreateVendor, useUpdateVendor, useVendor } from '../api';
import { VendorForm } from '../components/vendor-form';

export const vendorNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'vendors/new',
  component: VendorNewPage,
});

export const vendorEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'vendors/$id/edit',
  component: VendorEditPage,
});

function VendorNewPage() {
  const navigate = useNavigate();
  const create = useCreateVendor();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: CreateVendorInput) => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync(values);
      await navigate({ to: '/vendors/$id', params: { id: created.id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create vendor');
    }
  };

  return (
    <main className="container max-w-3xl py-10">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/vendors">
            <ArrowLeft />
            Back to vendors
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>New vendor</CardTitle>
            <CardDescription>Create a master record for a supplier.</CardDescription>
          </CardHeader>
          <CardContent>
            <VendorForm
              mode="create"
              onSubmit={onSubmit}
              submitError={submitError}
              onCancel={() => void navigate({ to: '/vendors' })}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function VendorEditPage() {
  const { id } = vendorEditRoute.useParams();
  const navigate = useNavigate();
  const { data: vendor, isLoading, isError, error } = useVendor(id);
  const update = useUpdateVendor(id);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: UpdateVendorInput) => {
    setSubmitError(null);
    try {
      await update.mutateAsync(values);
      await navigate({ to: '/vendors/$id', params: { id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update vendor');
    }
  };

  if (isLoading) {
    return (
      <main className="container max-w-3xl py-10">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading vendor…
        </div>
      </main>
    );
  }

  if (isError || !vendor) {
    return (
      <main className="container max-w-3xl py-10">
        <Card>
          <CardHeader>
            <CardTitle>Vendor not found</CardTitle>
            <CardDescription>
              {error instanceof Error ? error.message : 'This vendor could not be loaded.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/vendors">
                <ArrowLeft />
                Back to vendors
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
          <Link to="/vendors/$id" params={{ id }}>
            <ArrowLeft />
            Back to vendor
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardDescription className="font-mono">{vendor.code}</CardDescription>
            <CardTitle>Edit vendor</CardTitle>
          </CardHeader>
          <CardContent>
            <VendorForm
              mode="edit"
              vendor={vendor}
              onSubmit={onSubmit}
              submitError={submitError}
              onCancel={() => void navigate({ to: '/vendors/$id', params: { id } })}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
