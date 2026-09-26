// PR new + edit routes (UI-003-04).

import type { CreatePurchaseRequestInput, UpdatePurchaseRequestInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreatePurchaseRequest, usePurchaseRequest, useUpdatePurchaseRequest } from '../api';
import { PrStatusBadge } from '../components/pr-status-badge';
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
  // Tier-driven, per department (Purchase). The + New PR button is hidden from
  // anyone without entry rights, but this screen had no gate of its own —
  // typing the URL still handed over the create form (an L1 Viewer, an L4
  // Approver). Same guard shape as the edit page below.
  const { data: eff, isLoading: accessLoading } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'pr_create');
  // Where Cancel goes, and where ESC → Exit goes. Every other way off the
  // screen (Back link, breadcrumb, browser Back) gets "Are you sure?".
  const goBack = useCallback(() => void navigate({ to: '/purchase-requests' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });

  const onSubmit = async (values: CreatePurchaseRequestInput): Promise<void> => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync(values);
      exit.leave(
        () =>
          void navigate({
            to: '/purchase-requests/$id',
            params: { id: created.id },
            replace: true,
          }),
      );
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save PR. Try again.');
    }
  };

  if (accessLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading purchase request…
      </div>
    );
  }

  if (!perms.entry) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/purchase-requests" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back to Purchase Requests
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--amber2)' }}>
            You do not have permission to create a PR. Ask an admin.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {exit.dialog}
      <PurchaseRequestForm
        mode="create"
        title="New Purchase Request"
        backLabel="Back to Purchase Requests"
        onBack={goBack}
        onSubmit={onSubmit}
        submitError={submitError}
        onCancel={() => exit.leave(goBack)}
      />
    </div>
  );
}

function PurchaseRequestEditPage(): React.JSX.Element {
  const { id } = purchaseRequestEditRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = usePurchaseRequest(id);
  const update = useUpdatePurchaseRequest(id);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Tier-driven, per department (Purchase). This screen had no gate at all —
  // typing the URL handed the form to anyone, including an L1 Viewer and an
  // L4 Approver, who deliberately cannot change a saved record.
  const { data: eff, isLoading: accessLoading } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'pr_create');
  // Where Cancel goes, and where ESC → Exit goes.
  const goBack = useCallback(
    () => void navigate({ to: '/purchase-requests/$id', params: { id } }),
    [navigate, id],
  );
  const exit = useExitConfirm({ onExit: goBack });

  const onSubmit = async (values: UpdatePurchaseRequestInput): Promise<void> => {
    setSubmitError(null);
    try {
      await update.mutateAsync(values);
      exit.leave(
        () => void navigate({ to: '/purchase-requests/$id', params: { id }, replace: true }),
      );
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save PR. Try again.');
    }
  };

  if (isLoading || accessLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading purchase request…
      </div>
    );
  }

  if (!perms.edit) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/purchase-requests/$id" params={{ id }} className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back to PR
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--amber2)' }}>
            You do not have permission to edit a PR. Ask an admin.
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
            <Link to="/purchase-requests" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'PR not found. Refresh the page.'}
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
            This PR is on a PO and can no longer be edited.
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
      {exit.dialog}
      <PurchaseRequestForm
        mode="edit"
        title="Edit Purchase Request"
        subtitle={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <span className="td-code">{detail.code}</span>
            <PrStatusBadge status={detail.status} />
          </span>
        }
        backLabel="Back to PR"
        onBack={goBack}
        detail={detail}
        onSubmit={onSubmit}
        submitError={submitError}
        onCancel={() => exit.leave(goBack)}
      />
    </div>
  );
}
