import type { CreatePurchaseOrderInput, UpdatePurchaseOrderInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreatePurchaseOrder, usePurchaseOrder, useUpdatePurchaseOrder } from '../api';
import { PurchaseOrderForm } from '../components/purchase-order-form';

export const purchaseOrderNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'purchase-orders/new',
  component: PurchaseOrderNewPage,
});

export const purchaseOrderEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'purchase-orders/$id/edit',
  component: PurchaseOrderEditPage,
});

function PurchaseOrderNewPage() {
  const navigate = useNavigate();
  const create = useCreatePurchaseOrder();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: CreatePurchaseOrderInput) => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync(values);
      await navigate({
        to: '/purchase-orders/$id',
        params: { id: created.id },
        replace: true,
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create purchase order');
    }
  };

  return (
    <main className="container max-w-5xl py-10">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/purchase-orders">
            <ArrowLeft />
            Back to purchase orders
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>New purchase order</CardTitle>
            <CardDescription>Header + line items in a single save.</CardDescription>
          </CardHeader>
          <CardContent>
            <PurchaseOrderForm
              mode="create"
              onSubmit={onSubmit}
              submitError={submitError}
              onCancel={() => void navigate({ to: '/purchase-orders' })}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function PurchaseOrderEditPage() {
  const { id } = purchaseOrderEditRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = usePurchaseOrder(id);
  const update = useUpdatePurchaseOrder(id);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: UpdatePurchaseOrderInput) => {
    setSubmitError(null);
    try {
      await update.mutateAsync(values);
      await navigate({ to: '/purchase-orders/$id', params: { id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update purchase order');
    }
  };

  if (isLoading) {
    return (
      <main className="container max-w-5xl py-10">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading purchase order…
        </div>
      </main>
    );
  }

  if (isError || !detail) {
    return (
      <main className="container max-w-5xl py-10">
        <Card>
          <CardHeader>
            <CardTitle>Purchase order not found</CardTitle>
            <CardDescription>
              {error instanceof Error ? error.message : 'This purchase order could not be loaded.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/purchase-orders">
                <ArrowLeft />
                Back to purchase orders
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="container max-w-5xl py-10">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/purchase-orders/$id" params={{ id }}>
            <ArrowLeft />
            Back to PO
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardDescription className="font-mono">{detail.code}</CardDescription>
            <CardTitle>Edit purchase order</CardTitle>
          </CardHeader>
          <CardContent>
            <PurchaseOrderForm
              mode="edit"
              detail={detail}
              onSubmit={onSubmit}
              submitError={submitError}
              onCancel={() => void navigate({ to: '/purchase-orders/$id', params: { id } })}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
