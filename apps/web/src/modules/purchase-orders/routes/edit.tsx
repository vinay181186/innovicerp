// PO new + edit routes (UI-003-04).

import type { CreatePurchaseOrderInput, UpdatePurchaseOrderInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreatePurchaseOrder, usePurchaseOrder, useUpdatePurchaseOrder } from '../api';
import { PurchaseOrderForm } from '../components/purchase-order-form';

export const purchaseOrderNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'purchase-orders/new',
  component: PurchaseOrderNewPage,
});

export const purchaseOrderEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'purchase-orders/$id/edit',
  component: PurchaseOrderEditPage,
});

function PurchaseOrderNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const create = useCreatePurchaseOrder();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: CreatePurchaseOrderInput): Promise<void> => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync(values);
      await navigate({ to: '/purchase-orders/$id', params: { id: created.id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create purchase order');
    }
  };

  return (
    <div>
      <Link to="/purchase-orders" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Purchase Orders
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="panel-title">+ New Purchase Order</div>
            <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
              Header + line items in a single save.
            </div>
          </div>
        </div>
        <div className="panel-body">
          <PurchaseOrderForm
            mode="create"
            onSubmit={onSubmit}
            submitError={submitError}
            onCancel={() => void navigate({ to: '/purchase-orders' })}
          />
        </div>
      </div>
    </div>
  );
}

function PurchaseOrderEditPage(): React.JSX.Element {
  const { id } = purchaseOrderEditRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = usePurchaseOrder(id);
  const update = useUpdatePurchaseOrder(id);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: UpdatePurchaseOrderInput): Promise<void> => {
    setSubmitError(null);
    try {
      await update.mutateAsync(values);
      await navigate({ to: '/purchase-orders/$id', params: { id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update purchase order');
    }
  };

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading purchase order…
      </div>
    );
  }

  if (isError || !detail) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/purchase-orders" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Purchase order not found'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link
        to="/purchase-orders/$id"
        params={{ id }}
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 10 }}
      >
        <ArrowLeft size={14} /> Back to PO
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="td-code" style={{ color: 'var(--cyan)', fontSize: 14, fontWeight: 700 }}>
              {detail.code}
            </div>
            <div className="panel-title" style={{ marginTop: 2 }}>
              Edit Purchase Order
            </div>
          </div>
        </div>
        <div className="panel-body">
          <PurchaseOrderForm
            mode="edit"
            detail={detail}
            onSubmit={onSubmit}
            submitError={submitError}
            onCancel={() => void navigate({ to: '/purchase-orders/$id', params: { id } })}
          />
        </div>
      </div>
    </div>
  );
}
