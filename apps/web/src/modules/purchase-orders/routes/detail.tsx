import type { PurchaseOrderDetail, PurchaseOrderLine } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Inbox, Loader2, Pencil, Trash2 } from 'lucide-react';
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
import { usePurchaseOrder, useSoftDeletePurchaseOrder } from '../api';
import { PoStatusBadge } from '../components/po-status-badge';

export const purchaseOrderDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'purchase-orders/$id',
  component: PurchaseOrderDetailPage,
});

function PurchaseOrderDetailPage() {
  const { id } = purchaseOrderDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = usePurchaseOrder(id);
  const softDelete = useSoftDeletePurchaseOrder();
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  const onDelete = () => {
    softDelete.mutate(detail.id, {
      onSuccess: () => {
        void navigate({ to: '/purchase-orders', replace: true });
      },
    });
  };

  const totalQty = detail.lines.reduce((s, l) => s + l.qty, 0);
  const receivedQty = detail.lines.reduce((s, l) => s + l.receivedQty, 0);
  const totalValue = detail.lines.reduce((s, l) => s + l.qty * Number(l.rate), 0);

  return (
    <main className="container max-w-5xl py-10">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Button asChild variant="ghost" size="sm">
            <Link to="/purchase-orders">
              <ArrowLeft />
              Back
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            {['draft', 'open', 'partial', 'qc_pending'].includes(detail.status) ? (
              <Button asChild variant="default" size="sm">
                <Link to="/goods-receipt-notes/new" search={{ poId: detail.id }}>
                  <Inbox />
                  Receive (new GRN)
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="outline" size="sm">
              <Link to="/purchase-orders/$id/edit" params={{ id: detail.id }}>
                <Pencil />
                Edit
              </Link>
            </Button>
            {confirmDelete ? (
              <>
                <span className="text-sm text-muted-foreground">Delete this PO?</span>
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
              : 'Failed to delete purchase order.'}
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <CardDescription className="font-mono">{detail.code}</CardDescription>
            <CardTitle className="flex items-center gap-3">
              {detail.vendorCodeText ?? (detail.vendorId ? '— linked vendor —' : '—')}
              <PoStatusBadge status={detail.status} />
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
                {detail.lines.length} line{detail.lines.length === 1 ? '' : 's'} · qty{' '}
                <span className="font-mono text-foreground">{receivedQty}</span>
                <span className="text-xs">/{totalQty}</span> received
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

function DetailGrid(props: { detail: PurchaseOrderDetail }) {
  const { detail } = props;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm md:grid-cols-3">
      <Pair label="Type" value={detail.poType.replaceAll('_', ' ')} />
      <Pair label="Date" value={detail.poDate} />
      <Pair label="Due date" value={detail.dueDate ?? '—'} />
      <Pair label="Tax type" value={detail.taxType ?? '—'} />
      <Pair
        label="GST split"
        value={`SGST ${detail.sgstPct}% · CGST ${detail.cgstPct}% · IGST ${detail.igstPct}%`}
      />
      <Pair label="PR ref" value={detail.prCodeText ?? '—'} />
      <Pair label="Approved at" value={detail.approvedAt ?? '—'} />
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

function LinesTable(props: { lines: PurchaseOrderLine[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>#</TableHead>
          <TableHead>Item</TableHead>
          <TableHead>Item name</TableHead>
          <TableHead className="text-right">Qty</TableHead>
          <TableHead className="text-right">Rate</TableHead>
          <TableHead className="text-right">Received</TableHead>
          <TableHead>Due date</TableHead>
          <TableHead>Source</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.lines.length === 0 ? (
          <TableEmpty colSpan={8}>No lines on this PO yet.</TableEmpty>
        ) : (
          props.lines.map((l) => (
            <TableRow key={l.id}>
              <TableCell className="font-mono text-sm">{l.lineNo}</TableCell>
              <TableCell className="font-mono text-xs">
                {l.itemCodeText ?? (l.itemId ? '— linked —' : '—')}
              </TableCell>
              <TableCell>{l.itemName}</TableCell>
              <TableCell className="text-right font-mono">{l.qty}</TableCell>
              <TableCell className="text-right font-mono">
                {Number(l.rate) > 0 ? `₹${Number(l.rate).toFixed(2)}` : '—'}
              </TableCell>
              <TableCell className="text-right font-mono">
                <span
                  className={
                    l.receivedQty >= l.qty && l.qty > 0
                      ? 'text-green-600'
                      : l.receivedQty > 0
                        ? 'text-amber-600'
                        : 'text-muted-foreground'
                  }
                >
                  {l.receivedQty}
                </span>
              </TableCell>
              <TableCell className="text-xs">{l.dueDate ?? '—'}</TableCell>
              <TableCell className="text-xs">
                {l.sourceJcOpId ? (
                  <span className="text-muted-foreground">JC op</span>
                ) : l.sourceSoLineId ? (
                  <span className="text-muted-foreground">SO line</span>
                ) : (
                  '—'
                )}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
