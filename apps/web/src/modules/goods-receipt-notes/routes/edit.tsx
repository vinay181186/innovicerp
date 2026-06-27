// GRN new + edit routes (UI-003-05).

import type { UpdateGoodsReceiptNoteInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useGoodsReceiptNote, useUpdateGoodsReceiptNote } from '../api';
import { GoodsReceiptNoteForm } from '../components/goods-receipt-note-form';
import { UnifiedGrnForm } from '../components/unified-grn-form';

const newSearchSchema = z.object({
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

function GoodsReceiptNoteNewPage(): React.JSX.Element {
  const { poId } = goodsReceiptNoteNewRoute.useSearch();
  // Unified inward shell: type selector + per-type sections. The Purchase tab
  // reuses the same create form/endpoint this page used before (unchanged).
  return <UnifiedGrnForm {...(poId ? { initialPurchaseOrderId: poId } : {})} />;
}

function GoodsReceiptNoteEditPage(): React.JSX.Element {
  const { id } = goodsReceiptNoteEditRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useGoodsReceiptNote(id);
  const update = useUpdateGoodsReceiptNote(id);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: UpdateGoodsReceiptNoteInput): Promise<void> => {
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
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading GRN…
      </div>
    );
  }

  if (isError || !detail) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/goods-receipt-notes" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'GRN not found'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link
        to="/goods-receipt-notes/$id"
        params={{ id }}
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 10 }}
      >
        <ArrowLeft size={14} /> Back to GRN
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="td-code" style={{ color: 'var(--cyan)', fontSize: 14, fontWeight: 700 }}>
              {detail.code}
            </div>
            <div className="panel-title" style={{ marginTop: 2 }}>
              Edit GRN
            </div>
          </div>
        </div>
        <div className="panel-body">
          <GoodsReceiptNoteForm
            mode="edit"
            detail={detail}
            onSubmit={onSubmit}
            submitError={submitError}
            onCancel={() => void navigate({ to: '/goods-receipt-notes/$id', params: { id } })}
          />
        </div>
      </div>
    </div>
  );
}
