import type { Vendor } from '@innovic/shared';
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
import { useSoftDeleteVendor, useVendor } from '../api';

export const vendorDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'vendors/$id',
  component: VendorDetailPage,
});

function VendorDetailPage() {
  const { id } = vendorDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: vendor, isLoading, isError, error } = useVendor(id);
  const softDelete = useSoftDeleteVendor();
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  const onDelete = () => {
    softDelete.mutate(vendor.id, {
      onSuccess: () => {
        void navigate({ to: '/vendors', replace: true });
      },
    });
  };

  return (
    <main className="container max-w-3xl py-10">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Button asChild variant="ghost" size="sm">
            <Link to="/vendors">
              <ArrowLeft />
              Back
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/vendors/$id/edit" params={{ id: vendor.id }}>
                <Pencil />
                Edit
              </Link>
            </Button>
            {confirmDelete ? (
              <>
                <span className="text-sm text-muted-foreground">Delete this vendor?</span>
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
              : 'Failed to delete vendor.'}
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <CardDescription className="font-mono">{vendor.code}</CardDescription>
            <CardTitle>{vendor.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailGrid vendor={vendor} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function DetailGrid(props: { vendor: Vendor }) {
  const { vendor } = props;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm md:grid-cols-2">
      <Pair label="Status" value={vendor.isActive ? 'Active' : 'Inactive'} />
      <Pair label="Rating" value={vendor.rating ?? '—'} />
      <Pair label="Contact person" value={vendor.contactPerson ?? '—'} />
      <Pair label="Email" value={vendor.email ?? '—'} />
      <Pair label="Phone" value={vendor.phone ?? '—'} />
      <Pair label="GST number" value={vendor.gstNumber ?? '—'} />
      <Pair label="City" value={vendor.city ?? '—'} />
      <Pair label="State" value={vendor.state ?? '—'} />
      <Pair label="Pincode" value={vendor.pincode ?? '—'} />
      <div className="md:col-span-2">
        <dt className="text-xs uppercase tracking-wide text-muted-foreground">
          Materials supplied
        </dt>
        <dd className="mt-1 whitespace-pre-wrap">{vendor.materialsSupplied ?? '—'}</dd>
      </div>
      <div className="md:col-span-2">
        <dt className="text-xs uppercase tracking-wide text-muted-foreground">Address</dt>
        <dd className="mt-1 whitespace-pre-wrap">{vendor.addressLine1 ?? '—'}</dd>
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
