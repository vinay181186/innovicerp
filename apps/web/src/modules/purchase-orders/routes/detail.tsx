// PO detail page (UI-003-04).

import type { PurchaseOrderDetail, PurchaseOrderLine } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Check, Inbox, Loader2, Pencil, Printer, Send, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useApprovalConfig } from '@/modules/approval-config/api';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { usePrintTemplates } from '../../print-templates/api';
import { useMyCompany } from '../../settings/api';
import { useVendor } from '../../vendors/api';
import {
  useApprovePurchaseOrder,
  usePurchaseOrder,
  useRejectPurchaseOrder,
  useSoftDeletePurchaseOrder,
} from '../api';
import { PoStatusBadge } from '../components/po-status-badge';
import { printPurchaseOrder } from '../lib/print-po';

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
  const { data: vendor } = useVendor(detail?.vendorId ?? undefined);
  const { data: company } = useMyCompany();
  const { data: templates } = usePrintTemplates();
  const softDelete = useSoftDeletePurchaseOrder();
  const approveMut = useApprovePurchaseOrder();
  const rejectMut = useRejectPurchaseOrder();
  const { data: approvalCfg } = useApprovalConfig();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [approveRemarks, setApproveRemarks] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

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

  const onPrint = (): void => {
    const ok = printPurchaseOrder({
      po: detail,
      vendor,
      company,
      templates: templates?.items ?? [],
      currentUser: me?.email,
    });
    if (!ok) window.alert('Allow popups to print.');
  };

  const canEdit = me?.role === 'admin' || me?.role === 'manager';
  const isAdmin = me?.role === 'admin';
  const canIssueOrReceive = ['draft', 'open', 'partial', 'qc_pending'].includes(detail.status);
  const isApprover =
    isAdmin || (me ? (approvalCfg?.poApprovers ?? []).includes(me.id) : false);
  const showApprovalActions = detail.status === 'draft' && isApprover;

  async function doApprove(): Promise<void> {
    if (!detail) return;
    setActionError(null);
    try {
      const trimmed = approveRemarks.trim();
      const args: { id: string; remarks?: string } = { id: detail.id };
      if (trimmed) args.remarks = trimmed;
      await approveMut.mutateAsync(args);
      setApproveOpen(false);
      setApproveRemarks('');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Approve failed');
    }
  }

  async function doReject(): Promise<void> {
    if (!detail) return;
    setActionError(null);
    if (!rejectReason.trim()) {
      setActionError('Rejection reason is required');
      return;
    }
    try {
      await rejectMut.mutateAsync({ id: detail.id, reason: rejectReason.trim() });
      setRejectOpen(false);
      setRejectReason('');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Reject failed');
    }
  }

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
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <AssignTaskButton
              linkedRef={{
                type: 'purchase_order',
                id: detail.id,
                display: `PO ${detail.code}`,
                navPage: `/purchase-orders/${detail.id}`,
              }}
              suggestedTitle={`Follow up on PO ${detail.code}`}
            />
            {showApprovalActions ? (
              <>
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ background: 'var(--green)', color: '#fff', fontWeight: 700 }}
                  onClick={() => setApproveOpen(true)}
                >
                  <Check size={13} /> Approve
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => setRejectOpen(true)}
                >
                  <X size={13} /> Reject
                </button>
              </>
            ) : null}
            <button type="button" className="btn btn-ghost btn-sm" onClick={onPrint}>
              <Printer size={13} /> Print
            </button>
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

      {/* Approve modal */}
      {approveOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setApproveOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.45)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            padding: '10vh 16px',
            zIndex: 60,
          }}
        >
          <div
            className="panel"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(1100px, 96vw)' }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 16px',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div className="fw-700" style={{ color: 'var(--green)' }}>
                ✅ Approve PO — {detail.code}
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setApproveOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
            <div style={{ padding: 16, display: 'grid', gap: 12 }}>
              <div
                style={{
                  background: 'var(--bg3)',
                  padding: 12,
                  borderRadius: 8,
                  display: 'flex',
                  gap: 16,
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <span className="text3" style={{ fontSize: 10 }}>PO</span>
                  <br />
                  <b style={{ color: 'var(--cyan)' }}>{detail.code}</b>
                </div>
                <div>
                  <span className="text3" style={{ fontSize: 10 }}>VENDOR</span>
                  <br />
                  <b>{detail.vendorName ?? detail.vendorCodeText ?? '—'}</b>
                </div>
                <div>
                  <span className="text3" style={{ fontSize: 10 }}>LINES</span>
                  <br />
                  <b>{detail.lines.length}</b>
                </div>
                <div>
                  <span className="text3" style={{ fontSize: 10 }}>VALUE</span>
                  <br />
                  <b style={{ color: 'var(--green)' }}>
                    ₹{Math.round(totalValue).toLocaleString('en-IN')}
                  </b>
                </div>
              </div>
              <div className="form-grp">
                <label className="form-label">Approval Remarks</label>
                <input
                  className="innovic-input"
                  value={approveRemarks}
                  onChange={(e) => setApproveRemarks(e.target.value)}
                  placeholder="Optional comments…"
                />
              </div>
              {actionError ? (
                <div
                  style={{
                    padding: '8px 12px',
                    background: 'rgba(239,68,68,0.06)',
                    border: '1px solid rgba(239,68,68,0.3)',
                    borderRadius: 6,
                    color: 'var(--red)',
                    fontSize: 12,
                  }}
                >
                  {actionError}
                </div>
              ) : null}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setApproveOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ background: 'var(--green)', color: '#fff', fontWeight: 700 }}
                  disabled={approveMut.isPending}
                  onClick={() => void doApprove()}
                >
                  {approveMut.isPending ? (
                    <>
                      <Loader2 className="inline h-3 w-3 animate-spin" /> Approving…
                    </>
                  ) : (
                    'Approve PO'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Reject modal */}
      {rejectOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setRejectOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.45)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            padding: '10vh 16px',
            zIndex: 60,
          }}
        >
          <div
            className="panel"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(1100px, 96vw)' }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 16px',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div className="fw-700" style={{ color: 'var(--red)' }}>
                ❌ Reject PO — {detail.code}
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setRejectOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
            <div style={{ padding: 16, display: 'grid', gap: 12 }}>
              <div
                style={{
                  background: 'rgba(239,68,68,0.05)',
                  padding: 12,
                  border: '1px solid var(--red)',
                  borderRadius: 8,
                  fontSize: 11,
                  color: 'var(--text3)',
                }}
              >
                PO will be cancelled and sent back to creator for correction.
              </div>
              <div className="form-grp">
                <label className="form-label">
                  Rejection Reason <span className="req">★</span>
                </label>
                <textarea
                  className="innovic-input"
                  rows={3}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Why is this PO being rejected…"
                />
              </div>
              {actionError ? (
                <div
                  style={{
                    padding: '8px 12px',
                    background: 'rgba(239,68,68,0.06)',
                    border: '1px solid rgba(239,68,68,0.3)',
                    borderRadius: 6,
                    color: 'var(--red)',
                    fontSize: 12,
                  }}
                >
                  {actionError}
                </div>
              ) : null}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setRejectOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={rejectMut.isPending}
                  onClick={() => void doReject()}
                >
                  {rejectMut.isPending ? (
                    <>
                      <Loader2 className="inline h-3 w-3 animate-spin" /> Rejecting…
                    </>
                  ) : (
                    'Reject PO'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
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
