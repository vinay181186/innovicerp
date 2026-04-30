import type { Item } from '@innovic/shared';
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
import { useItem, useSoftDeleteItem } from '../api';

export const itemDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'items/$id',
  component: ItemDetailPage,
});

function ItemDetailPage() {
  const { id } = itemDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: item, isLoading, isError, error } = useItem(id);
  const softDelete = useSoftDeleteItem();
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  const onDelete = () => {
    softDelete.mutate(item.id, {
      onSuccess: () => {
        void navigate({ to: '/items', replace: true });
      },
    });
  };

  return (
    <main className="container max-w-3xl py-10">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Button asChild variant="ghost" size="sm">
            <Link to="/items">
              <ArrowLeft />
              Back
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/items/$id/edit" params={{ id: item.id }}>
                <Pencil />
                Edit
              </Link>
            </Button>
            {confirmDelete ? (
              <>
                <span className="text-sm text-muted-foreground">Delete this item?</span>
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
              : 'Failed to delete item.'}
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <CardDescription className="font-mono">{item.code}</CardDescription>
            <CardTitle>{item.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailGrid item={item} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function DetailGrid(props: { item: Item }) {
  const { item } = props;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm md:grid-cols-2">
      <Pair label="Item type" value={item.itemType} />
      <Pair label="UOM" value={item.uom} />
      <Pair label="Revision" value={item.revision} />
      <Pair label="Drawing no" value={item.drawingNo ?? '—'} />
      <Pair label="Material" value={item.material ?? '—'} />
      <Pair label="HSN code" value={item.hsnCode ?? '—'} />
      <div className="md:col-span-2">
        <dt className="text-xs uppercase tracking-wide text-muted-foreground">Description</dt>
        <dd className="mt-1 whitespace-pre-wrap">{item.description ?? '—'}</dd>
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
