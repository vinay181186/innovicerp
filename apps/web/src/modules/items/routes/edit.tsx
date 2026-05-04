import type { CreateItemInput, UpdateItemInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateItem, useItem, useUpdateItem } from '../api';
import { ItemForm } from '../components/item-form';

export const itemNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'items/new',
  component: ItemNewPage,
});

export const itemEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'items/$id/edit',
  component: ItemEditPage,
});

function ItemNewPage() {
  const navigate = useNavigate();
  const create = useCreateItem();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: CreateItemInput) => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync(values);
      await navigate({ to: '/items/$id', params: { id: created.id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create item');
    }
  };

  return (
    <main className="container max-w-3xl py-10">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/items">
            <ArrowLeft />
            Back to items
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>New item</CardTitle>
            <CardDescription>Create a master record for a component or assembly.</CardDescription>
          </CardHeader>
          <CardContent>
            <ItemForm
              mode="create"
              onSubmit={onSubmit}
              submitError={submitError}
              onCancel={() => void navigate({ to: '/items' })}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function ItemEditPage() {
  const { id } = itemEditRoute.useParams();
  const navigate = useNavigate();
  const { data: item, isLoading, isError, error } = useItem(id);
  const update = useUpdateItem(id);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: UpdateItemInput) => {
    setSubmitError(null);
    try {
      await update.mutateAsync(values);
      await navigate({ to: '/items/$id', params: { id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update item');
    }
  };

  if (isLoading) {
    return (
      <main className="container max-w-3xl py-10">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading item…
        </div>
      </main>
    );
  }

  if (isError || !item) {
    return (
      <main className="container max-w-3xl py-10">
        <Card>
          <CardHeader>
            <CardTitle>Item not found</CardTitle>
            <CardDescription>
              {error instanceof Error ? error.message : 'This item could not be loaded.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/items">
                <ArrowLeft />
                Back to items
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
          <Link to="/items/$id" params={{ id }}>
            <ArrowLeft />
            Back to item
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardDescription className="font-mono">{item.code}</CardDescription>
            <CardTitle>Edit item</CardTitle>
          </CardHeader>
          <CardContent>
            <ItemForm
              mode="edit"
              item={item}
              onSubmit={onSubmit}
              submitError={submitError}
              onCancel={() => void navigate({ to: '/items/$id', params: { id } })}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
