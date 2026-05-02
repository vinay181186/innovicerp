import type { JobWorkOrderDetail, JobWorkOrderLine } from '@innovic/shared';
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
import { SoStatusBadge } from '@/modules/sales-orders/components/so-status-badge';
import { useJobWorkOrder, useSoftDeleteJobWorkOrder } from '../api';
import { JwMaterialStatusBadge } from '../components/jw-material-status';

export const jobWorkOrderDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-work-orders/$id',
  component: JobWorkOrderDetailPage,
});

function JobWorkOrderDetailPage() {
  const { id } = jobWorkOrderDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useJobWorkOrder(id);
  const softDelete = useSoftDeleteJobWorkOrder();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isLoading) {
    return (
      <main className="container max-w-5xl py-10">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading job-work order…
        </div>
      </main>
    );
  }

  if (isError || !detail) {
    return (
      <main className="container max-w-5xl py-10">
        <Card>
          <CardHeader>
            <CardTitle>Job-work order not found</CardTitle>
            <CardDescription>
              {error instanceof Error
                ? error.message
                : 'This job-work order could not be loaded.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/job-work-orders">
                <ArrowLeft />
                Back to job-work orders
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
        void navigate({ to: '/job-work-orders', replace: true });
      },
    });
  };

  const totalQty = detail.lines.reduce((s, l) => s + l.orderQty, 0);
  const clientMatTotal = detail.lines.reduce((s, l) => s + Number(l.clientMaterialQty ?? 0), 0);
  const matRecvTotal = detail.lines.reduce((s, l) => s + Number(l.materialReceivedQty ?? 0), 0);

  return (
    <main className="container max-w-5xl py-10">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Button asChild variant="ghost" size="sm">
            <Link to="/job-work-orders">
              <ArrowLeft />
              Back
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/job-work-orders/$id/edit" params={{ id: detail.id }}>
                <Pencil />
                Edit
              </Link>
            </Button>
            {confirmDelete ? (
              <>
                <span className="text-sm text-muted-foreground">Delete this JW?</span>
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
              : 'Failed to delete job-work order.'}
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <CardDescription className="font-mono">{detail.code}</CardDescription>
            <CardTitle className="flex items-center gap-3">
              {detail.customerName ?? 'Untitled customer'}
              <SoStatusBadge status={detail.status} />
              <JwMaterialStatusBadge
                receivedQty={matRecvTotal}
                expectedQty={clientMatTotal}
              />
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
                {clientMatTotal > 0 ? (
                  <>
                    {' '}
                    · client material{' '}
                    <span className="font-mono text-foreground">
                      {matRecvTotal}/{clientMatTotal}
                    </span>
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

function DetailGrid(props: { detail: JobWorkOrderDetail }) {
  const { detail } = props;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm md:grid-cols-3">
      <Pair label="Date" value={detail.jwDate} />
      <Pair label="Client PO" value={detail.clientPoNo ?? '—'} />
      <Pair label="Status" value={detail.status} />
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

function LinesTable(props: { lines: JobWorkOrderLine[] }) {
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
          <TableHead>Due date</TableHead>
          <TableHead>Client material</TableHead>
          <TableHead>Material status</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.lines.length === 0 ? (
          <TableEmpty colSpan={11}>No lines on this JW yet.</TableEmpty>
        ) : (
          props.lines.map((l) => (
            <TableRow key={l.id}>
              <TableCell className="font-mono text-sm">{l.lineNo}</TableCell>
              <TableCell className="font-mono text-xs">
                {l.itemCodeText ?? (l.itemId ? '— linked —' : '—')}
              </TableCell>
              <TableCell>{l.partName}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{l.material ?? '—'}</TableCell>
              <TableCell className="font-mono text-xs">{l.drawingNo ?? '—'}</TableCell>
              <TableCell className="text-right font-mono">{l.orderQty}</TableCell>
              <TableCell>{l.uom}</TableCell>
              <TableCell className="text-xs">{l.dueDate ?? '—'}</TableCell>
              <TableCell className="text-xs">
                {l.clientMaterial ? (
                  <span className="font-mono">
                    {l.clientMaterial}
                    {l.clientMaterialQty ? ` (${l.clientMaterialQty})` : ''}
                  </span>
                ) : (
                  '—'
                )}
              </TableCell>
              <TableCell>
                <JwMaterialStatusBadge
                  receivedQty={Number(l.materialReceivedQty ?? 0)}
                  expectedQty={Number(l.clientMaterialQty ?? 0)}
                />
              </TableCell>
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
