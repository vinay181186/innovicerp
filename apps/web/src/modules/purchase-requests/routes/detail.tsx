// PR detail page (UI-003-04).

import type { PurchaseRequestDetail } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, FileText, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { usePurchaseRequest, useSoftDeletePurchaseRequest } from '../api';
import { PrStatusBadge } from '../components/pr-status-badge';

export const purchaseRequestDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'purchase-requests/$id',
  component: PurchaseRequestDetailPage,
});

function PurchaseRequestDetailPage(): React.JSX.Element {
  const { id } = purchaseRequestDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = usePurchaseRequest(id);
  const { data: me } = useSession();
  const softDelete = useSoftDeletePurchaseRequest();
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  const onDelete = (): void => {
    softDelete.mutate(detail.id, {
      onSuccess: () => {
        void navigate({ to: '/purchase-requests', replace: true });
      },
    });
  };

  const canEdit = me?.role === 'admin' || me?.role === 'manager';
  const isAdmin = me?.role === 'admin';
  const linkedToPo = detail.poId !== null;

  return (
    <div>
      <Link to="/purchase-requests" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Purchase Requests
      </Link>

      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="td-code" style={{ color: 'var(--cyan)', fontSize: 16, fontWeight: 700 }}>
              {detail.code}
            </div>
            <div
              className="panel-title"
              style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 10 }}
            >
              {detail.itemName ?? detail.itemCodeText ?? 'Untitled item'}
              <PrStatusBadge status={detail.status} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <AssignTaskButton
              linkedRef={{
                type: 'purchase_request',
                id: detail.id,
                display: `PR ${detail.code}`,
                navPage: `/purchase-requests/${detail.id}`,
              }}
              suggestedTitle={`Follow up on PR ${detail.code}`}
            />
            {(detail.status === 'open' || detail.status === 'approved') && canWrite(me?.role) ? (
              <Link
                to="/purchase-orders/from-pr"
                search={{ prId: detail.id }}
                className="btn btn-primary btn-sm"
              >
                <FileText size={13} /> Create PO
              </Link>
            ) : null}
            {detail.poId ? (
              <Link
                to="/purchase-orders/$id"
                params={{ id: detail.poId }}
                className="btn btn-ghost btn-sm"
              >
                <FileText size={13} /> Open linked PO
              </Link>
            ) : null}
            {canEdit ? (
              <Link
                to="/purchase-requests/$id/edit"
                params={{ id: detail.id }}
                className="btn btn-ghost btn-sm"
              >
                <Pencil size={13} /> Edit
              </Link>
            ) : null}
            {isAdmin ? (
              confirmDelete ? (
                <>
                  <span className="text3" style={{ fontSize: 12, alignSelf: 'center' }}>
                    Delete?
                  </span>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={onDelete}
                    disabled={softDelete.isPending}
                  >
                    {softDelete.isPending ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Trash2 size={13} />
                    )}
                    Confirm
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setConfirmDelete(false)}
                    disabled={softDelete.isPending}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => setConfirmDelete(true)}
                  disabled={linkedToPo}
                  title={linkedToPo ? 'PR has a linked PO — cancel instead of delete' : undefined}
                >
                  <Trash2 size={13} /> Delete
                </button>
              )
            ) : null}
          </div>
        </div>
        <div className="panel-body">
          {softDelete.isError ? (
            <div
              style={{
                color: 'var(--red)',
                background: 'var(--red3)',
                border: '1px solid #fca5a5',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 12,
                marginBottom: 10,
              }}
            >
              {softDelete.error instanceof Error
                ? softDelete.error.message
                : 'Failed to delete purchase request.'}
            </div>
          ) : null}
          <DetailGrid detail={detail} />
        </div>
      </div>
    </div>
  );
}

function canWrite(role: string | undefined): boolean {
  return role === 'admin' || role === 'manager';
}

function DetailGrid(props: { detail: PurchaseRequestDetail }): React.JSX.Element {
  const { detail } = props;
  const estCostNum = Number(detail.estCost);
  return (
    <div className="form-grid form-grid-3">
      <Pair label="Date" value={detail.prDate} />
      <Pair label="Vendor" value={detail.vendorName ?? detail.vendorCodeText ?? '—'} />
      <Pair label="Item code" value={detail.itemCode ?? detail.itemCodeText ?? '—'} />
      <Pair label="Qty" value={String(detail.qty)} />
      <Pair label="Estimated cost" value={estCostNum > 0 ? `₹${estCostNum.toFixed(2)}` : '—'} />
      <Pair label="Required date" value={detail.requiredDate ?? '—'} />
      <Pair label="Operation" value={detail.operation ?? '—'} />
      <Pair label="Source JC op" value={detail.sourceJcOpId ? '— linked —' : '—'} />
      <Pair label="Source SO line" value={detail.sourceSoLineId ? '— linked —' : '—'} />
      <Pair label="Linked PO" value={detail.poId ? '— linked —' : '—'} />
      <Pair label="Approved at" value={detail.approvedAt ?? '—'} />
      <Pair label="PO created at" value={detail.poCreatedAt ?? '—'} />
      <div className="form-grp form-full">
        <span className="form-label">Remarks</span>
        <div style={{ whiteSpace: 'pre-wrap' }}>{detail.remarks ?? '—'}</div>
      </div>
    </div>
  );
}

function Pair(props: { label: string; value: string | React.ReactNode }): React.JSX.Element {
  return (
    <div className="form-grp">
      <span className="form-label">{props.label}</span>
      <div style={{ fontWeight: 600 }}>{props.value}</div>
    </div>
  );
}
