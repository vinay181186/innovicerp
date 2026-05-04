import type { PurchaseRequest } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, FileText, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authenticatedRoute } from '@/routes/_authenticated';
import { usePurchaseRequest, useSoftDeletePurchaseRequest } from '../api';
import { PrStatusBadge } from '../components/pr-status-badge';

export const purchaseRequestDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'purchase-requests/$id',
  component: PurchaseRequestDetailPage,
});

function PurchaseRequestDetailPage() {
  const { id } = purchaseRequestDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = usePurchaseRequest(id);
  const softDelete = useSoftDeletePurchaseRequest();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isLoading) {
    return (
      <main className="container max-w-4xl py-10">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading purchase request…
        </div>
      </main>
    );
  }

  if (isError || !detail) {
    return (
      <main className="container max-w-4xl py-10">
        <Card>
          <CardHeader>
            <CardTitle>Purchase request not found</CardTitle>
            <CardDescription>
              {error instanceof Error
                ? error.message
                : 'This purchase request could not be loaded.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/purchase-requests">
                <ArrowLeft />
                Back to purchase requests
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
        void navigate({ to: '/purchase-requests', replace: true });
      },
    });
  };

  const linkedToPo = detail.poId !== null;

  return (
    <main className="container max-w-4xl py-10">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Button asChild variant="ghost" size="sm">
            <Link to="/purchase-requests">
              <ArrowLeft />
              Back
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            {detail.status === 'open' || detail.status === 'approved' ? (
              <Button asChild variant="default" size="sm">
                <Link to="/purchase-orders/from-pr" search={{ prId: detail.id }}>
                  <FileText />
                  Create PO
                </Link>
              </Button>
            ) : null}
            {detail.poId ? (
              <Button asChild variant="outline" size="sm">
                <Link to="/purchase-orders/$id" params={{ id: detail.poId }}>
                  <FileText />
                  Open linked PO
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="outline" size="sm">
              <Link to="/purchase-requests/$id/edit" params={{ id: detail.id }}>
                <Pencil />
                Edit
              </Link>
            </Button>
            {confirmDelete ? (
              <>
                <span className="text-sm text-muted-foreground">Delete this PR?</span>
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
                disabled={linkedToPo}
                title={linkedToPo ? 'PR has a linked PO — cancel instead of delete' : undefined}
              >
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
              : 'Failed to delete purchase request.'}
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <CardDescription className="font-mono">{detail.code}</CardDescription>
            <CardTitle className="flex items-center gap-3">
              {detail.itemName ?? detail.itemCodeText ?? 'Untitled item'}
              <PrStatusBadge status={detail.status} />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DetailGrid detail={detail} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function DetailGrid(props: { detail: PurchaseRequest }) {
  const { detail } = props;
  const estCostNum = Number(detail.estCost);
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm md:grid-cols-3">
      <Pair label="Date" value={detail.prDate} />
      <Pair
        label="Vendor"
        value={detail.vendorId ? '— linked —' : (detail.vendorCodeText ?? '—')}
      />
      <Pair label="Item code" value={detail.itemCodeText ?? (detail.itemId ? '— linked —' : '—')} />
      <Pair label="Qty" value={String(detail.qty)} />
      <Pair label="Estimated cost" value={estCostNum > 0 ? `₹${estCostNum.toFixed(2)}` : '—'} />
      <Pair label="Required date" value={detail.requiredDate ?? '—'} />
      <Pair label="Operation" value={detail.operation ?? '—'} />
      <Pair label="Source JC op" value={detail.sourceJcOpId ? '— linked —' : '—'} />
      <Pair label="Source SO line" value={detail.sourceSoLineId ? '— linked —' : '—'} />
      <Pair label="Linked PO" value={detail.poId ? '— linked —' : '—'} />
      <Pair label="Approved at" value={detail.approvedAt ?? '—'} />
      <Pair label="PO created at" value={detail.poCreatedAt ?? '—'} />
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
