import type { DeliveryChallanWithLines } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Ban, Inbox, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCancelDeliveryChallan, useDeliveryChallan } from '../api';
import { DcStatusBadge } from '../components/dc-status-badge';

export const deliveryChallanDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'delivery-challans/$id',
  component: DeliveryChallanDetailPage,
});

function DeliveryChallanDetailPage() {
  const { id } = deliveryChallanDetailRoute.useParams();
  const { data: detail, isLoading, isError, error } = useDeliveryChallan(id);
  const { data: me } = useSession();
  const cancel = useCancelDeliveryChallan();
  const [cancelError, setCancelError] = useState<string | null>(null);

  const onCancel = async (): Promise<void> => {
    if (!id) return;
    if (
      !window.confirm(
        'Cancel this delivery challan? This reverses jc_op state + writes a compensating stock IN row. Cannot be undone.',
      )
    ) {
      return;
    }
    setCancelError(null);
    try {
      await cancel.mutateAsync(id);
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : 'Failed to cancel DC.');
    }
  };

  if (isLoading) {
    return (
      <main className="container max-w-4xl py-10">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading delivery challan…
        </div>
      </main>
    );
  }
  if (isError || !detail) {
    return (
      <main className="container max-w-4xl py-10">
        <Card>
          <CardHeader>
            <CardTitle>Delivery challan not found</CardTitle>
            <CardDescription>
              {error instanceof Error
                ? error.message
                : 'This delivery challan could not be loaded.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/delivery-challans">
                <ArrowLeft />
                Back to delivery challans
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const totalQty = detail.lines.reduce((sum, l) => sum + Number(l.qty), 0);

  const receivedAggregates = useMemo(() => {
    const map = new Map<string, { received: number; rejected: number }>();
    for (const r of detail.receipts) {
      for (const rl of r.lines) {
        const prev = map.get(rl.deliveryChallanLineId) ?? { received: 0, rejected: 0 };
        prev.received += Number(rl.receivedQty);
        prev.rejected += Number(rl.rejectedQty);
        map.set(rl.deliveryChallanLineId, prev);
      }
    }
    return map;
  }, [detail.receipts]);

  return (
    <main className="container max-w-5xl py-10">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/delivery-challans">
            <ArrowLeft />
            Back
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardDescription className="font-mono">{detail.code}</CardDescription>
                <CardTitle className="flex items-center gap-3">
                  {detail.vendorName ?? detail.vendorCodeText}
                  <DcStatusBadge status={detail.status} />
                </CardTitle>
              </div>
              <div className="flex items-center gap-2">
                {detail.status === 'issued' && (me?.role === 'admin' || me?.role === 'manager') ? (
                  <Button asChild variant="default" size="sm">
                    <Link to="/delivery-challans/$id/receive" params={{ id: detail.id }}>
                      <Inbox />
                      Receive
                    </Link>
                  </Button>
                ) : null}
                {detail.status === 'issued' && me?.role === 'admin' ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => void onCancel()}
                    disabled={cancel.isPending}
                  >
                    {cancel.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Cancelling…
                      </>
                    ) : (
                      <>
                        <Ban />
                        Cancel DC
                      </>
                    )}
                  </Button>
                ) : null}
              </div>
            </div>
            {cancelError ? (
              <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {cancelError}
              </div>
            ) : null}
          </CardHeader>
          <CardContent>
            <HeaderGrid detail={detail} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Lines ({detail.lines.length}) · total qty {totalQty.toFixed(0)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Item code</TableHead>
                    <TableHead>Item name</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead className="text-right">Sent</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    <TableHead className="text-right">Rejected</TableHead>
                    <TableHead>UOM</TableHead>
                    <TableHead>Remarks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.lines.map((line) => {
                    const agg = receivedAggregates.get(line.id) ?? { received: 0, rejected: 0 };
                    return (
                      <TableRow key={line.id}>
                        <TableCell className="font-mono text-xs">{line.lineNo}</TableCell>
                        <TableCell className="font-mono text-xs">{line.itemCodeText}</TableCell>
                        <TableCell className="text-sm">{line.itemNameText ?? '—'}</TableCell>
                        <TableCell className="text-xs">{line.materialText ?? '—'}</TableCell>
                        <TableCell className="text-right font-mono text-sm font-semibold">
                          {Number(line.qty).toFixed(0)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {agg.received.toFixed(0)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {agg.rejected.toFixed(0)}
                        </TableCell>
                        <TableCell className="text-xs uppercase">{line.uom}</TableCell>
                        <TableCell className="text-xs whitespace-pre-wrap">
                          {line.dcRemarks ?? '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {detail.receipts.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Receipts ({detail.receipts.length})</CardTitle>
              <CardDescription>
                Inward records against this DC. Rejected qty auto-creates an NC in the same tx.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {detail.receipts.map((r) => (
                  <div key={r.id} className="rounded-md border bg-card">
                    <div className="flex items-center justify-between border-b px-4 py-2 text-sm">
                      <div className="font-mono">{r.receiptCode}</div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>Receipt date: {r.receiptDate}</span>
                        {r.vendorInvoiceText ? <span>Invoice: {r.vendorInvoiceText}</span> : null}
                      </div>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>DC line</TableHead>
                          <TableHead className="text-right">Received</TableHead>
                          <TableHead className="text-right">Rejected</TableHead>
                          <TableHead>Reject reason</TableHead>
                          <TableHead>Remarks</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {r.lines.map((rl) => {
                          const dcLine = detail.lines.find(
                            (l) => l.id === rl.deliveryChallanLineId,
                          );
                          return (
                            <TableRow key={rl.id}>
                              <TableCell className="font-mono text-xs">
                                #{dcLine?.lineNo ?? '?'} · {dcLine?.itemCodeText ?? '—'}
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm">
                                {Number(rl.receivedQty).toFixed(0)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm">
                                {Number(rl.rejectedQty).toFixed(0)}
                              </TableCell>
                              <TableCell className="text-xs whitespace-pre-wrap">
                                {rl.rejectReason ?? '—'}
                              </TableCell>
                              <TableCell className="text-xs whitespace-pre-wrap">
                                {rl.remarks ?? '—'}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </main>
  );
}

function HeaderGrid(props: { detail: DeliveryChallanWithLines }) {
  const { detail } = props;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm md:grid-cols-3">
      <Pair label="DC date" value={detail.dcDate} />
      <Pair
        label="Purchase order"
        value={
          detail.poCode ? detail.poCode : `${detail.poCodeText} (text snapshot — PO not in DB)`
        }
      />
      <Pair
        label="Sales order"
        value={
          detail.soCode
            ? detail.soCode
            : detail.soRefText
              ? `ref:${detail.soRefText} (snapshot)`
              : '—'
        }
      />
      <Pair label="Vendor" value={detail.vendorName ?? detail.vendorCodeText} />
      <Pair label="Transport" value={detail.transport ?? '—'} />
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
