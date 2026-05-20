// PO detail page (UI-003-04).

import type { PurchaseOrderDetail, PurchaseOrderLine } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Inbox, Loader2, Pencil, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { usePurchaseOrder, useSoftDeletePurchaseOrder } from '../api';
import { PoStatusBadge } from '../components/po-status-badge';

export const purchaseOrderDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'purchase-orders/$id',
  component: PurchaseOrderDetailPage,
});

function PurchaseOrderDetailPage(): React.JSX.Element {
  const { id } = purchaseOrderDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = usePurchaseOrder(id);
  const { data: me } = useSession();
  const softDelete = useSoftDeletePurchaseOrder();
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  const onDelete = (): void => {
    softDelete.mutate(detail.id, {
      onSuccess: () => {
        void navigate({ to: '/purchase-orders', replace: true });
      },
    });
  };

  const canEdit = me?.role === 'admin' || me?.role === 'manager';
  const isAdmin = me?.role === 'admin';
  const canIssueOrReceive = ['draft', 'open', 'partial', 'qc_pending'].includes(detail.status);

  const totalQty = detail.lines.reduce((s, l) => s + l.qty, 0);
  const receivedQty = detail.lines.reduce((s, l) => s + l.receivedQty, 0);
  const totalValue = detail.lines.reduce((s, l) => s + l.qty * Number(l.rate), 0);

  return (
    <div>
      <Link to="/purchase-orders" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Purchase Orders
      </Link>

      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div
              className="td-code"
              style={{ color: 'var(--cyan)', fontSize: 16, fontWeight: 800 }}
            >
              {detail.code}
            </div>
            <div
              className="panel-title"
              style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 10 }}
            >
              {detail.vendorName ?? detail.vendorCodeText ?? '—'}
              <PoStatusBadge status={detail.status} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {canIssueOrReceive && detail.poType === 'job_work' && canEdit ? (
              <Link
                to="/delivery-challans/new"
                search={{ poId: detail.id }}
                className="btn btn-primary btn-sm"
              >
                <Send size={13} /> Issue DC
              </Link>
            ) : null}
            {canIssueOrReceive && detail.poType !== 'job_work' && canEdit ? (
              <Link
                to="/goods-receipt-notes/new"
                search={{ poId: detail.id }}
                className="btn btn-primary btn-sm"
              >
                <Inbox size={13} /> Receive (new GRN)
              </Link>
            ) : null}
            {canEdit ? (
              <Link
                to="/purchase-orders/$id/edit"
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
                : 'Failed to delete purchase order.'}
            </div>
          ) : null}
          <DetailGrid detail={detail} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title">Line items ({detail.lines.length})</div>
          <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
            qty <b style={{ color: 'var(--text)' }}>{receivedQty}</b>/{totalQty} received
            {totalValue > 0 ? (
              <>
                {' '}
                · value <b style={{ color: 'var(--text)' }}>₹{totalValue.toFixed(2)}</b>
              </>
            ) : null}
          </span>
        </div>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Item</th>
                <th>Item Name</th>
                <th className="td-right">Qty</th>
                <th className="td-right">Rate</th>
                <th className="td-right">Received</th>
                <th>Due</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty-state">
                    No lines on this PO yet.
                  </td>
                </tr>
              ) : (
                detail.lines.map((l) => <LineRow key={l.id} line={l} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function LineRow(props: { line: PurchaseOrderLine }): React.JSX.Element {
  const { line: l } = props;
  const color =
    l.receivedQty >= l.qty && l.qty > 0
      ? 'var(--green)'
      : l.receivedQty > 0
        ? 'var(--amber)'
        : 'var(--text3)';
  return (
    <tr>
      <td className="mono">{l.lineNo}</td>
      <td className="mono" style={{ fontSize: 11 }}>
        {l.itemCode ?? l.itemCodeText ?? '—'}
      </td>
      <td>{l.itemName}</td>
      <td className="td-right mono">{l.qty}</td>
      <td className="td-right mono">
        {Number(l.rate) > 0 ? `₹${Number(l.rate).toFixed(2)}` : '—'}
      </td>
      <td className="td-right mono" style={{ color, fontWeight: 700 }}>
        {l.receivedQty}
      </td>
      <td className="text2" style={{ fontSize: 11 }}>
        {l.dueDate ?? '—'}
      </td>
      <td className="text3" style={{ fontSize: 11 }}>
        {l.sourceJcOpId ? 'JC op' : l.sourceSoLineId ? 'SO line' : '—'}
      </td>
    </tr>
  );
}

function DetailGrid(props: { detail: PurchaseOrderDetail }): React.JSX.Element {
  const { detail } = props;
  return (
    <div className="form-grid form-grid-3">
      <Pair label="Type" value={detail.poType.replaceAll('_', ' ')} />
      <Pair label="Date" value={detail.poDate} />
      <Pair label="Due date" value={detail.dueDate ?? '—'} />
      <Pair label="Tax type" value={detail.taxType ?? '—'} />
      <Pair
        label="GST split"
        value={`SGST ${detail.sgstPct}% · CGST ${detail.cgstPct}% · IGST ${detail.igstPct}%`}
      />
      <Pair label="PR ref" value={detail.prCodeText ?? '—'} />
      <Pair label="Approved at" value={detail.approvedAt ?? '—'} />
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
