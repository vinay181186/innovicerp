import type { DeliveryChallanWithLines } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
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
import { authenticatedRoute } from '@/routes/_authenticated';
import { useDeliveryChallan } from '../api';
import { DcStatusBadge } from '../components/dc-status-badge';

export const deliveryChallanDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'delivery-challans/$id',
  component: DeliveryChallanDetailPage,
});

function DeliveryChallanDetailPage() {
  const { id } = deliveryChallanDetailRoute.useParams();
  const { data: detail, isLoading, isError, error } = useDeliveryChallan(id);

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
            <CardDescription className="font-mono">{detail.code}</CardDescription>
            <CardTitle className="flex items-center gap-3">
              {detail.vendorName ?? detail.vendorCodeText}
              <DcStatusBadge status={detail.status} />
            </CardTitle>
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
                    <TableHead>Qty</TableHead>
                    <TableHead>UOM</TableHead>
                    <TableHead>Remarks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="font-mono text-xs">{line.lineNo}</TableCell>
                      <TableCell className="font-mono text-xs">{line.itemCodeText}</TableCell>
                      <TableCell className="text-sm">{line.itemNameText ?? '—'}</TableCell>
                      <TableCell className="text-xs">{line.materialText ?? '—'}</TableCell>
                      <TableCell className="font-mono text-sm font-semibold">
                        {Number(line.qty).toFixed(0)}
                      </TableCell>
                      <TableCell className="text-xs uppercase">{line.uom}</TableCell>
                      <TableCell className="text-xs whitespace-pre-wrap">
                        {line.dcRemarks ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
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
