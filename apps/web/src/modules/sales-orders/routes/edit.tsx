import type { CreateSalesOrderInput, UpdateSalesOrderInput } from '@innovic/shared';
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
import { useCreateSalesOrder, useSalesOrder, useUpdateSalesOrder } from '../api';
import { SalesOrderForm } from '../components/sales-order-form';

export const salesOrderNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'sales-orders/new',
  component: SalesOrderNewPage,
});

export const salesOrderEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'sales-orders/$id/edit',
  component: SalesOrderEditPage,
});

function SalesOrderNewPage() {
  const navigate = useNavigate();
  const create = useCreateSalesOrder();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: CreateSalesOrderInput) => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync(values);
      await navigate({
        to: '/sales-orders/$id',
        params: { id: created.id },
        replace: true,
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create sales order');
    }
  };

  return (
    <main className="container max-w-5xl py-10">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/sales-orders">
            <ArrowLeft />
            Back to sales orders
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>New sales order</CardTitle>
            <CardDescription>Header + line items in a single save.</CardDescription>
          </CardHeader>
          <CardContent>
            <SalesOrderForm
              mode="create"
              onSubmit={onSubmit}
              submitError={submitError}
              onCancel={() => void navigate({ to: '/sales-orders' })}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function SalesOrderEditPage() {
  const { id } = salesOrderEditRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useSalesOrder(id);
  const update = useUpdateSalesOrder(id);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: UpdateSalesOrderInput) => {
    setSubmitError(null);
    try {
      await update.mutateAsync(values);
      await navigate({ to: '/sales-orders/$id', params: { id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update sales order');
    }
  };

  if (isLoading) {
    return (
      <main className="container max-w-5xl py-10">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading sales order…
        </div>
      </main>
    );
  }

  if (isError || !detail) {
    return (
      <main className="container max-w-5xl py-10">
        <Card>
          <CardHeader>
            <CardTitle>Sales order not found</CardTitle>
            <CardDescription>
              {error instanceof Error ? error.message : 'This sales order could not be loaded.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/sales-orders">
                <ArrowLeft />
                Back to sales orders
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
          <Link to="/sales-orders/$id" params={{ id }}>
            <ArrowLeft />
            Back to SO
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardDescription className="font-mono">{detail.code}</CardDescription>
            <CardTitle>Edit sales order</CardTitle>
          </CardHeader>
          <CardContent>
            <SalesOrderForm
              mode="edit"
              detail={detail}
              onSubmit={onSubmit}
              submitError={submitError}
              onCancel={() => void navigate({ to: '/sales-orders/$id', params: { id } })}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
