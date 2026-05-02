import type { Item } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Package, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useItemBalance,
  useStoreTransactionsList,
} from '@/modules/store-transactions/api';
import { TxnTypeBadge } from '@/modules/store-transactions/components/txn-type-badge';
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
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardDescription className="font-mono">{item.code}</CardDescription>
                <CardTitle className="flex items-center gap-3">
                  {item.name}
                  <OnHandBadge itemId={item.id} />
                </CardTitle>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <DetailGrid item={item} />
          </CardContent>
        </Card>

        <StockHistoryCard itemId={item.id} />
      </div>
    </main>
  );
}

function OnHandBadge(props: { itemId: string }) {
  const { data, isLoading } = useItemBalance(props.itemId);
  if (isLoading) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> stock…
      </span>
    );
  }
  const onHand = data?.onHand ?? 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${
        onHand > 0
          ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
          : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
      }`}
      title="On-hand from v_item_stock — sum of in/out/adjust txns"
    >
      <Package className="h-3 w-3" />
      On hand: <span className="font-mono">{onHand}</span>
    </span>
  );
}

function StockHistoryCard(props: { itemId: string }) {
  const { data, isLoading, isError } = useStoreTransactionsList({
    itemId: props.itemId,
    limit: 20,
    offset: 0,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Stock history</CardTitle>
        <CardDescription>
          Last 20 ledger entries for this item.{' '}
          <Link
            to="/store-transactions"
            search={(prev) => ({ ...prev })}
            className="underline-offset-4 hover:underline"
          >
            View full ledger →
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Ref</TableHead>
              <TableHead>Stock before → after</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableEmpty colSpan={6}>
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading stock history…
                </span>
              </TableEmpty>
            ) : isError ? (
              <TableEmpty colSpan={6}>
                <span className="text-destructive">Failed to load stock history.</span>
              </TableEmpty>
            ) : (data?.items.length ?? 0) === 0 ? (
              <TableEmpty colSpan={6}>
                No stock transactions for this item yet.
              </TableEmpty>
            ) : (
              data!.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm">{r.txnDate}</TableCell>
                  <TableCell>
                    <TxnTypeBadge type={r.txnType} />
                  </TableCell>
                  <TableCell className="text-right font-mono">{r.qty}</TableCell>
                  <TableCell className="text-xs uppercase text-muted-foreground">
                    {r.sourceType.replaceAll('_', ' ')}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.sourceRef}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.stockBefore} → <b>{r.stockAfter}</b>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
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
