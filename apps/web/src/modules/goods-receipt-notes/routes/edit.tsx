import type { CreateGoodsReceiptNoteInput, UpdateGoodsReceiptNoteInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateGoodsReceiptNote, useGoodsReceiptNote, useUpdateGoodsReceiptNote } from '../api';
import { GoodsReceiptNoteForm } from '../components/goods-receipt-note-form';

const newSearchSchema = z.object({
  /** Optional — when set, the form auto-selects this PO and pre-fills lines
   *  from its remaining qty. Set by the "Receive (new GRN)" link on PO detail. */
  poId: z.string().uuid().optional(),
});

export const goodsReceiptNoteNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'goods-receipt-notes/new',
  validateSearch: newSearchSchema,
  component: GoodsReceiptNoteNewPage,
});

export const goodsReceiptNoteEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'goods-receipt-notes/$id/edit',
  component: GoodsReceiptNoteEditPage,
});

function GoodsReceiptNoteNewPage() {
  const { poId } = goodsReceiptNoteNewRoute.useSearch();
  const navigate = useNavigate();
  const create = useCreateGoodsReceiptNote();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: CreateGoodsReceiptNoteInput) => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync(values);
      await navigate({
        to: '/goods-receipt-notes/$id',
        params: { id: created.id },
        replace: true,
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create GRN');
    }
  };

  return (
    <main className="container max-w-5xl py-10">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/goods-receipt-notes">
            <ArrowLeft />
            Back to GRNs
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>New goods receipt note</CardTitle>
            <CardDescription>
              Receive material against a PO. QC accept on a line writes a stock-in ledger entry.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <GoodsReceiptNoteForm
              mode="create"
              {...(poId ? { initialPurchaseOrderId: poId } : {})}
              onSubmit={onSubmit}
              submitError={submitError}
              onCancel={() => void navigate({ to: '/goods-receipt-notes' })}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function GoodsReceiptNoteEditPage() {
  const { id } = goodsReceiptNoteEditRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useGoodsReceiptNote(id);
  const update = useUpdateGoodsReceiptNote(id);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: UpdateGoodsReceiptNoteInput) => {
    setSubmitError(null);
    try {
      await update.mutateAsync(values);
      await navigate({ to: '/goods-receipt-notes/$id', params: { id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update GRN');
    }
  };

  if (isLoading) {
    return (
      <main className="container max-w-5xl py-10">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading GRN…
        </div>
      </main>
    );
  }

  if (isError || !detail) {
    return (
      <main className="container max-w-5xl py-10">
        <Card>
          <CardHeader>
            <CardTitle>GRN not found</CardTitle>
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

  return (
    <main className="container max-w-5xl py-10">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/goods-receipt-notes/$id" params={{ id }}>
            <ArrowLeft />
            Back to GRN
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardDescription className="font-mono">{detail.code}</CardDescription>
            <CardTitle>Edit GRN</CardTitle>
          </CardHeader>
          <CardContent>
            <GoodsReceiptNoteForm
              mode="edit"
              detail={detail}
              onSubmit={onSubmit}
              submitError={submitError}
              onCancel={() => void navigate({ to: '/goods-receipt-notes/$id', params: { id } })}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
