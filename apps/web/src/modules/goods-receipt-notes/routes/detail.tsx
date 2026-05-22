// GRN detail (UI-003-05).

import type { GoodsReceiptNoteDetail, GoodsReceiptNoteLineDetail } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useGoodsReceiptNote, useSoftDeleteGoodsReceiptNote } from '../api';
import { QcStatusBadge } from '../components/qc-status-badge';

export const goodsReceiptNoteDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'goods-receipt-notes/$id',
  component: GoodsReceiptNoteDetailPage,
});

function GoodsReceiptNoteDetailPage(): React.JSX.Element {
  const { id } = goodsReceiptNoteDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useGoodsReceiptNote(id);
  const { data: me } = useSession();
  const softDelete = useSoftDeleteGoodsReceiptNote();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading goods receipt note…
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

  const onDelete = (): void => {
    softDelete.mutate(detail.id, {
      onSuccess: () => {
        void navigate({ to: '/goods-receipt-notes', replace: true });
      },
    });
  };

  const canEdit = me?.role === 'admin' || me?.role === 'manager';
  const isAdmin = me?.role === 'admin';

  const totalReceived = detail.lines.reduce((s, l) => s + l.receivedQty, 0);
  const totalAccepted = detail.lines.reduce((s, l) => s + l.qcAcceptedQty, 0);
  const totalRejected = detail.lines.reduce((s, l) => s + l.qcRejectedQty, 0);
  const anyCompleted = detail.lines.some((l) => l.qcStatus === 'completed');

  return (
    <div>
      <Link to="/goods-receipt-notes" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to GRN list
      </Link>

      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="td-code" style={{ color: 'var(--cyan)', fontSize: 16, fontWeight: 700 }}>
              {detail.code}
            </div>
            <div className="panel-title" style={{ marginTop: 2 }}>
              {detail.vendorName ?? detail.vendorCodeText ?? '—'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {detail.purchaseOrderId ? (
              <Link
                to="/purchase-orders/$id"
                params={{ id: detail.purchaseOrderId }}
                className="btn btn-ghost btn-sm"
              >
                Open PO
              </Link>
            ) : null}
            {canEdit ? (
              <Link
                to="/goods-receipt-notes/$id/edit"
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
                  disabled={anyCompleted}
                  title={
                    anyCompleted
                      ? 'GRN has at least one QC-completed line — create a reversing GRN line instead'
                      : undefined
                  }
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
                : 'Failed to delete GRN.'}
            </div>
          ) : null}
          <DetailGrid detail={detail} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title">Line items ({detail.lines.length})</div>
          <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
            received <b style={{ color: 'var(--text)' }}>{totalReceived}</b> · accepted{' '}
            <b style={{ color: 'var(--green2)' }}>{totalAccepted}</b> · rejected{' '}
            <b style={{ color: 'var(--amber2)' }}>{totalRejected}</b>
          </span>
        </div>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Item</th>
                <th>Item Name</th>
                <th className="td-right">Received</th>
                <th>DC ref</th>
                <th>QC</th>
                <th className="td-right">Accepted</th>
                <th className="td-right">Rejected</th>
                <th>QC date</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty-state">
                    No lines on this GRN yet.
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

function LineRow(props: { line: GoodsReceiptNoteLineDetail }): React.JSX.Element {
  const { line: l } = props;
  return (
    <tr>
      <td className="mono">{l.lineNo}</td>
      <td className="mono" style={{ fontSize: 11 }}>
        {l.itemCode ?? l.itemCodeText ?? '—'}
      </td>
      <td>{l.itemName}</td>
      <td className="td-right mono">{l.receivedQty}</td>
      <td className="mono" style={{ fontSize: 11 }}>
        {l.dcRefNo ?? '—'}
      </td>
      <td>
        <QcStatusBadge status={l.qcStatus} />
      </td>
      <td className="td-right mono" style={{ color: 'var(--green2)' }}>
        {l.qcAcceptedQty}
      </td>
      <td className="td-right mono" style={{ color: 'var(--amber2)' }}>
        {l.qcRejectedQty}
      </td>
      <td className="text2" style={{ fontSize: 11 }}>
        {l.qcDate ?? '—'}
      </td>
    </tr>
  );
}

function DetailGrid(props: { detail: GoodsReceiptNoteDetail }): React.JSX.Element {
  const { detail } = props;
  return (
    <div className="form-grid form-grid-3">
      <Pair label="Date" value={detail.grnDate} />
      <Pair label="DC No." value={detail.dcNo ?? '—'} />
      <Pair label="Invoice No." value={detail.invoiceNo ?? '—'} />
      <Pair label="PO" value={detail.poCode ?? detail.poCodeText ?? '—'} />
      <Pair
        label="Vendor"
        value={detail.vendorName ?? detail.vendorCodeText ?? '—'}
      />
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
