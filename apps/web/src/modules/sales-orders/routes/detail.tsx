import type { SalesOrderDetail, SalesOrderLine } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useSalesOrder, useSoftDeleteSalesOrder } from '../api';
import { SoStatusBadge } from '../components/so-status-badge';

export const salesOrderDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'sales-orders/$id',
  component: SalesOrderDetailPage,
});

function SalesOrderDetailPage() {
  const { id } = salesOrderDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useSalesOrder(id);
  const softDelete = useSoftDeleteSalesOrder();
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  const onDelete = () => {
    softDelete.mutate(detail.id, {
      onSuccess: () => {
        void navigate({ to: '/sales-orders', replace: true });
      },
    });
  };

  const totalQty = detail.lines.reduce((s, l) => s + l.orderQty, 0);
  const totalValue = detail.lines.reduce((s, l) => s + l.orderQty * Number(l.rate), 0);

  return (
    <main className="container max-w-5xl py-10">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Button asChild variant="ghost" size="sm">
            <Link to="/sales-orders">
              <ArrowLeft />
              Back
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/sales-orders/$id/edit" params={{ id: detail.id }}>
                <Pencil />
                Edit
              </Link>
            </Button>
            {confirmDelete ? (
              <>
                <span className="text-sm text-muted-foreground">Delete this SO?</span>
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
              : 'Failed to delete sales order.'}
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <CardDescription className="font-mono">{detail.code}</CardDescription>
            <CardTitle className="flex items-center gap-3">
              {detail.customerName ?? 'Untitled customer'}
              <SoStatusBadge status={detail.status} />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DetailGrid detail={detail} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Line items</CardTitle>
              <span className="text-sm text-muted-foreground">
                {detail.lines.length} line{detail.lines.length === 1 ? '' : 's'} · total qty{' '}
                <span className="font-mono text-foreground">{totalQty}</span>
                {totalValue > 0 ? (
                  <>
                    {' '}
                    · value{' '}
                    <span className="font-mono text-foreground">₹{totalValue.toFixed(2)}</span>
                  </>
                ) : null}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <LinesTable lines={detail.lines} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function DetailGrid(props: { detail: SalesOrderDetail }) {
  const { detail } = props;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm md:grid-cols-3">
      <Pair label="Type" value={detail.type.replaceAll('_', ' ')} />
      <Pair label="Date" value={detail.soDate} />
      <Pair label="GST %" value={`${detail.gstPercent}%`} />
      <Pair label="Client PO" value={detail.clientPoNo ?? '—'} />
      <Pair label="Cost center" value={detail.costCenter ?? '—'} />
      <Pair
        label="BOM master"
        value={detail.bomMasterId ? `${detail.bomMasterId} (${detail.bomStatus ?? '—'})` : '—'}
      />
      <div className="md:col-span-3">
        <dt className="text-xs uppercase tracking-wide text-muted-foreground">Remarks</dt>
        <dd className="mt-1 whitespace-pre-wrap">{detail.remarks ?? '—'}</dd>
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

function LinesTable(props: { lines: SalesOrderLine[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>#</TableHead>
          <TableHead>Item</TableHead>
          <TableHead>Part name</TableHead>
          <TableHead>Material</TableHead>
          <TableHead>Drawing</TableHead>
          <TableHead className="text-right">Qty</TableHead>
          <TableHead>UOM</TableHead>
          <TableHead className="text-right">Rate</TableHead>
          <TableHead>Due date</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.lines.length === 0 ? (
          <TableEmpty colSpan={10}>No lines on this SO yet.</TableEmpty>
        ) : (
          props.lines.map((l) => (
            <TableRow key={l.id}>
              <TableCell className="font-mono text-sm">{l.lineNo}</TableCell>
              <TableCell className="font-mono text-xs">
                {l.itemCode ?? l.itemCodeText ?? '—'}
              </TableCell>
              <TableCell>{l.partName}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{l.material ?? '—'}</TableCell>
              <TableCell className="font-mono text-xs">{l.drawingNo ?? '—'}</TableCell>
              <TableCell className="text-right font-mono">{l.orderQty}</TableCell>
              <TableCell>{l.uom}</TableCell>
              <TableCell className="text-right font-mono">
                {Number(l.rate) > 0 ? `₹${Number(l.rate).toFixed(2)}` : '—'}
              </TableCell>
              <TableCell className="text-xs">{l.dueDate ?? '—'}</TableCell>
              <TableCell>
                <SoStatusBadge status={l.status} />
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
