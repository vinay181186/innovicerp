// GRN new + edit routes (UI-003-05).

import type { UpdateGoodsReceiptNoteInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
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
  // Tier-driven, per department (Store). The + New GRN button is hidden from
  // anyone without entry rights, but this screen had no gate of its own —
  // typing the URL still handed over the live inward form (an L1 Viewer, an
  // L4 Approver). `new` and `edit` share this file but not this gate.
  const { data: eff, isLoading: accessLoading } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'grn_create');

  if (accessLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading GRN…
      </div>
    );
  }

  if (!perms.entry) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/goods-receipt-notes" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back to GRN list
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--amber)' }}>
            ⛔ You do not have create access to GRN. Ask an admin for L2 Data Entry or above in
            Store.
          </div>
        </div>
      </div>
    );
  }

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
  // Tier-driven, per department (Store). This screen had no gate at all —
  // typing the URL handed the form to anyone, including an L1 Viewer and an
  // L2 Data Entry clerk, who deliberately cannot change a saved record.
  const { data: eff, isLoading: accessLoading } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'grn_create');

  const onSubmit = async (values: UpdateGoodsReceiptNoteInput): Promise<void> => {
    setSubmitError(null);
    try {
      await update.mutateAsync(values);
      await navigate({ to: '/goods-receipt-notes/$id', params: { id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update GRN');
    }
  };

  if (isLoading || accessLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading GRN…
      </div>
    );
  }

  if (!perms.edit) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/goods-receipt-notes/$id" params={{ id }} className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back to GRN
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--amber)' }}>
            ⛔ You do not have edit access to GRN. Ask an admin for L3 Editor or above in Store.
          </div>
        </div>
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
            <div
              className="td-code"
              style={{ color: 'var(--cyan)', fontSize: 14, fontWeight: 700 }}
            >
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
