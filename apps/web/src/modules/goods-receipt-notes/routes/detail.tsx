import type { GoodsReceiptNoteDetail, GoodsReceiptNoteLine } from '@innovic/shared';
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
import { useGoodsReceiptNote, useSoftDeleteGoodsReceiptNote } from '../api';
import { QcStatusBadge } from '../components/qc-status-badge';

export const goodsReceiptNoteDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'goods-receipt-notes/$id',
  component: GoodsReceiptNoteDetailPage,
});

function GoodsReceiptNoteDetailPage() {
  const { id } = goodsReceiptNoteDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useGoodsReceiptNote(id);
  const softDelete = useSoftDeleteGoodsReceiptNote();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isLoading) {
    return (
      <main className="container max-w-5xl py-10">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading goods receipt note…
        </div>
      </main>
    );
  }

  if (isError || !detail) {
    return (
      <main className="container max-w-5xl py-10">
        <Card>
          <CardHeader>
            <CardTitle>Goods receipt note not found</CardTitle>
            <CardDescription>
              {error instanceof Error ? error.message : 'This GRN could not be loaded.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/goods-receipt-notes">
                <ArrowLeft />
                Back to GRNs
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
        void navigate({ to: '/goods-receipt-notes', replace: true });
      },
    });
  };

  const totalReceived = detail.lines.reduce((s, l) => s + l.receivedQty, 0);
  const totalAccepted = detail.lines.reduce((s, l) => s + l.qcAcceptedQty, 0);
  const totalRejected = detail.lines.reduce((s, l) => s + l.qcRejectedQty, 0);
  const anyCompleted = detail.lines.some((l) => l.qcStatus === 'completed');

  return (
    <main className="container max-w-5xl py-10">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Button asChild variant="ghost" size="sm">
            <Link to="/goods-receipt-notes">
              <ArrowLeft />
              Back
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            {detail.purchaseOrderId ? (
              <Button asChild variant="outline" size="sm">
                <Link to="/purchase-orders/$id" params={{ id: detail.purchaseOrderId }}>
                  Open PO
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="outline" size="sm">
              <Link to="/goods-receipt-notes/$id/edit" params={{ id: detail.id }}>
                <Pencil />
                Edit
              </Link>
            </Button>
            {confirmDelete ? (
              <>
                <span className="text-sm text-muted-foreground">Delete this GRN?</span>
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
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                disabled={anyCompleted}
                title={
                  anyCompleted
                    ? 'GRN has at least one QC-completed line — create a reversing GRN line instead'
                    : undefined
                }
              >
                <Trash2 />
                Delete
              </Button>
            )}
          </div>
        </div>

        {softDelete.isError ? (
          <p className="text-sm text-destructive">
            {softDelete.error instanceof Error ? softDelete.error.message : 'Failed to delete GRN.'}
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <CardDescription className="font-mono">{detail.code}</CardDescription>
            <CardTitle>
              {detail.vendorCodeText ?? (detail.vendorId ? '— linked vendor —' : '—')}
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
                {detail.lines.length} line{detail.lines.length === 1 ? '' : 's'} · received{' '}
                <span className="font-mono text-foreground">{totalReceived}</span> · accepted{' '}
                <span className="font-mono text-green-700 dark:text-green-300">
                  {totalAccepted}
                </span>{' '}
                · rejected{' '}
                <span className="font-mono text-amber-700 dark:text-amber-300">
                  {totalRejected}
                </span>
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

function DetailGrid(props: { detail: GoodsReceiptNoteDetail }) {
  const { detail } = props;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm md:grid-cols-3">
      <Pair label="Date" value={detail.grnDate} />
      <Pair label="DC No." value={detail.dcNo ?? '—'} />
      <Pair label="Invoice No." value={detail.invoiceNo ?? '—'} />
      <Pair label="PO" value={detail.purchaseOrderId ? '— linked —' : (detail.poCodeText ?? '—')} />
      <Pair
        label="Vendor"
        value={detail.vendorId ? '— linked —' : (detail.vendorCodeText ?? '—')}
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

function LinesTable(props: { lines: GoodsReceiptNoteLine[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>#</TableHead>
          <TableHead>Item</TableHead>
          <TableHead>Item name</TableHead>
          <TableHead className="text-right">Received</TableHead>
          <TableHead>DC ref</TableHead>
          <TableHead>QC</TableHead>
          <TableHead className="text-right">Accepted</TableHead>
          <TableHead className="text-right">Rejected</TableHead>
          <TableHead>QC date</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.lines.length === 0 ? (
          <TableEmpty colSpan={9}>No lines on this GRN yet.</TableEmpty>
        ) : (
          props.lines.map((l) => (
            <TableRow key={l.id}>
              <TableCell className="font-mono text-sm">{l.lineNo}</TableCell>
              <TableCell className="font-mono text-xs">
                {l.itemCodeText ?? (l.itemId ? '— linked —' : '—')}
              </TableCell>
              <TableCell>{l.itemName}</TableCell>
              <TableCell className="text-right font-mono">{l.receivedQty}</TableCell>
              <TableCell className="font-mono text-xs">{l.dcRefNo ?? '—'}</TableCell>
              <TableCell>
                <QcStatusBadge status={l.qcStatus} />
              </TableCell>
              <TableCell className="text-right font-mono text-green-700 dark:text-green-300">
                {l.qcAcceptedQty}
              </TableCell>
              <TableCell className="text-right font-mono text-amber-700 dark:text-amber-300">
                {l.qcRejectedQty}
              </TableCell>
              <TableCell className="text-xs">{l.qcDate ?? '—'}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
