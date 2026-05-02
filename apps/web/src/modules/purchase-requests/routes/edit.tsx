import type { CreatePurchaseRequestInput, UpdatePurchaseRequestInput } from '@innovic/shared';
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
import {
  useCreatePurchaseRequest,
  usePurchaseRequest,
  useUpdatePurchaseRequest,
} from '../api';
import { PurchaseRequestForm } from '../components/purchase-request-form';

export const purchaseRequestNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'purchase-requests/new',
  component: PurchaseRequestNewPage,
});

export const purchaseRequestEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'purchase-requests/$id/edit',
  component: PurchaseRequestEditPage,
});

function PurchaseRequestNewPage() {
  const navigate = useNavigate();
  const create = useCreatePurchaseRequest();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: CreatePurchaseRequestInput) => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync(values);
      await navigate({
        to: '/purchase-requests/$id',
        params: { id: created.id },
        replace: true,
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create purchase request');
    }
  };

  return (
    <main className="container max-w-4xl py-10">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/purchase-requests">
            <ArrowLeft />
            Back to purchase requests
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>New purchase request</CardTitle>
            <CardDescription>
              Procurement intent — pick a vendor + item, set qty + cost.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PurchaseRequestForm
              mode="create"
              onSubmit={onSubmit}
              submitError={submitError}
              onCancel={() => void navigate({ to: '/purchase-requests' })}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function PurchaseRequestEditPage() {
  const { id } = purchaseRequestEditRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = usePurchaseRequest(id);
  const update = useUpdatePurchaseRequest(id);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: UpdatePurchaseRequestInput) => {
    setSubmitError(null);
    try {
      await update.mutateAsync(values);
      await navigate({ to: '/purchase-requests/$id', params: { id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update purchase request');
    }
  };

  if (isLoading) {
    return (
      <main className="container max-w-4xl py-10">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading purchase request…
        </div>
      </main>
    );
  }

  if (isError || !detail) {
    return (
      <main className="container max-w-4xl py-10">
        <Card>
          <CardHeader>
            <CardTitle>Purchase request not found</CardTitle>
            <CardDescription>
              {error instanceof Error
                ? error.message
                : 'This purchase request could not be loaded.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/purchase-requests">
                <ArrowLeft />
                Back to purchase requests
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="container max-w-4xl py-10">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/purchase-requests/$id" params={{ id }}>
            <ArrowLeft />
            Back to PR
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardDescription className="font-mono">{detail.code}</CardDescription>
            <CardTitle>Edit purchase request</CardTitle>
          </CardHeader>
          <CardContent>
            <PurchaseRequestForm
              mode="edit"
              detail={detail}
              onSubmit={onSubmit}
              submitError={submitError}
              onCancel={() => void navigate({ to: '/purchase-requests/$id', params: { id } })}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
