// PR new + edit routes (UI-003-04).

import type { CreatePurchaseRequestInput, UpdatePurchaseRequestInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreatePurchaseRequest, usePurchaseRequest, useUpdatePurchaseRequest } from '../api';
import { PurchaseRequestForm } from '../components/purchase-request-form';

export const purchaseRequestNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'purchase-requests/new',
  component: PurchaseRequestNewPage,
});

export const purchaseRequestEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'purchase-requests/$id/edit',
  component: PurchaseRequestEditPage,
});

function PurchaseRequestNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const create = useCreatePurchaseRequest();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: CreatePurchaseRequestInput): Promise<void> => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync(values);
      await navigate({ to: '/purchase-requests/$id', params: { id: created.id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create purchase request');
    }
  };

  return (
    <div>
      <Link to="/purchase-requests" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Purchase Requests
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="panel-title">📝 New Purchase Request</div>
            <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
              Procurement intent — pick a vendor + item, set qty + cost.
            </div>
          </div>
        </div>
        <div className="panel-body">
          <PurchaseRequestForm
            mode="create"
            onSubmit={onSubmit}
            submitError={submitError}
            onCancel={() => void navigate({ to: '/purchase-requests' })}
          />
        </div>
      </div>
    </div>
  );
}

function PurchaseRequestEditPage(): React.JSX.Element {
  const { id } = purchaseRequestEditRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = usePurchaseRequest(id);
  const update = useUpdatePurchaseRequest(id);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: UpdatePurchaseRequestInput): Promise<void> => {
    setSubmitError(null);
    try {
      await update.mutateAsync(values);
      await navigate({ to: '/purchase-requests/$id', params: { id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update purchase request');
    }
  };

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading purchase request…
      </div>
    );
  }

  if (isError || !detail) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/purchase-requests" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Purchase request not found'}
          </div>
        </div>
      </div>
    );
  }

  // A PR that has been converted to a PO is locked — no edits.
  if (detail.poId !== null || detail.status === 'po_created') {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/purchase-requests/$id" params={{ id }} className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back to PR
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--amber2)' }}>
            This purchase request is linked to a PO and can no longer be edited.
            {detail.poId ? (
              <>
                {' '}
                <Link
                  to="/purchase-orders/$id"
                  params={{ id: detail.poId }}
                  className="td-code"
                  style={{ color: 'var(--cyan)', fontWeight: 700 }}
                >
                  View the PO →
                </Link>
              </>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link
        to="/purchase-requests/$id"
        params={{ id }}
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 10 }}
      >
        <ArrowLeft size={14} /> Back to PR
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="td-code" style={{ color: 'var(--cyan)', fontSize: 14, fontWeight: 700 }}>
              {detail.code}
            </div>
            <div className="panel-title" style={{ marginTop: 2 }}>
              Edit Purchase Request
            </div>
          </div>
        </div>
        <div className="panel-body">
          <PurchaseRequestForm
            mode="edit"
            detail={detail}
            onSubmit={onSubmit}
            submitError={submitError}
            onCancel={() => void navigate({ to: '/purchase-requests/$id', params: { id } })}
          />
        </div>
      </div>
    </div>
  );
}
