// PO detail page (UI-003-04). Ports legacy `viewPO(id)` L26299-26438 — the real
// PO detail renderer. NOT `renderPurchaseOrders()` L25209, which is the LIST
// (router key `purchaseorders`, already ported in routes/list.tsx). Legacy
// packages the detail as a `showModalLg` off the list's View action (L25259);
// our shell is a route + panels, so the panel/back-link chrome is ours and the
// CONTENT below mirrors legacy section-for-section:
//   L26364-26376  Vendor box | PO Details box (2-col)
//   L26377-26399  summary tiles
//   L26400-26404  ▸ PO LINE ITEMS (n) + table
//
// Legacy deltas kept deliberately (see report / ISSUE-153..156):
//  - Tax + Total tiles (L26394-26398) now read the STORED header roll-up
//    (subtotal / tax_amount / total_amount, migration 0078) the API persists —
//    no tax math in React (CLAUDE.md rule 1). The full Subtotal/SGST/CGST/Grand
//    totals box (L26405-26429) with the legal per-tax split is still out of
//    scope. Subtotal/Total Qty/Received tiles reuse the reduces this page had.
//  - No GRN RECEIPTS table + Print QC Report (L26430-26437): the PO detail
//    payload carries no GRNs, and fetching them is a new API call.
//  - No per-line Status column (L26347 `badge(p.status)`):
//    `purchaseOrderLineSchema` has no status field — lines carry no status.
//  - "Source" occupies legacy's SO Line slot (L26340): the payload has
//    `sourceSoLineId`/`sourceJcOpId` (uuids) but no SO line NUMBER, so legacy's
//    `L1 [CPO:2]` cannot be reproduced. Same precedent as list.tsx's PR ref.
//  - No two-value type badge (L26306-26307 `Job Work PO`/`With Material PO`):
//    `PO_TYPES` has FOUR values and legacy's vocabulary has two — labelling an
//    `outsource`/`service` PO "With Material PO" is exactly the ISSUE-124 error
//    in markup. The Type field renders the real enum value instead.
//  - Dates render as stored (`YYYY-MM-DD`), not legacy `fmt()`'s `15-Jul-26`:
//    list.tsx renders them the same way, so formatting only here would open an
//    ISSUE-098-shaped seam inside one module. Closes module-wide with ISSUE-040.
//
// Kept over legacy (never delete a working feature): Back link, Approve/Reject,
// Delete, Assign task, Issue DC / Receive (new GRN), Due date, Tax type, GST
// split, PR ref, Approved at.
//
// CSS pass 2026-08-13 (user-supplied header mock). PRESENTATION ONLY — no data,
// query, mutation or calculation changed. The legacy trio above the line items
// (2-up Vendor / PO Details boxes → 6 bordered KPI tiles → a loose wrapped strip
// of label/value pairs, each with its own border, fill, alignment and value
// size) is now ONE four-column band, `components/po-header-band.tsx`:
// SUPPLIER | ORDER REFERENCES | TOTALS | TAX & APPROVAL, hairline-divided, under
// a status accent bar. Every field those three blocks showed is still on screen;
// the vendor name moved out of the panel header into the SUPPLIER column, where
// its address and GSTIN already belonged.

import type { PurchaseOrderLine } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Check, Inbox, Loader2, Pencil, Printer, Send, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useApprovalConfig } from '@/modules/approval-config/api';
import { RelatedDocsTabs } from '@/components/shared/related-docs-tabs';
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
import { PoHeaderBand } from '../components/po-header-band';
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
      <div className="panel empty-state" style={{ padding: 24 }}>
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
        Loading purchase order…
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
  // Money is hidden for L1 Viewers: the API nulls the header amount and every
  // line rate together, so a null total is the single signal to blank ₹ here.
  const priceHidden = detail.totalAmount == null;
  const totalValue = detail.lines.reduce((s, l) => s + l.qty * Number(l.rate ?? 0), 0);

  return (
    <div>
      <Link to="/purchase-orders" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Purchase Orders
      </Link>

      <div className="panel" style={{ overflow: 'hidden' }}>
        <div className="panel-hdr">
          {/* Code + status on one line: the vendor name used to sit here as a
              second line and now heads the SUPPLIER column of the band below,
              where its address and GSTIN are. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div
              className="td-code"
              style={{ color: 'var(--blue)', fontSize: 16, fontWeight: 800 }}
            >
              {detail.code}
            </div>
            <PoStatusBadge status={detail.status} />
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
        {softDelete.isError ? (
          <div
            style={{
              color: 'var(--red)',
              background: 'var(--red3)',
              border: '1px solid var(--red)',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 12,
              margin: '10px 14px 0',
            }}
          >
            {softDelete.error instanceof Error
              ? softDelete.error.message
              : 'Failed to delete purchase order.'}
          </div>
        ) : null}
        <PoHeaderBand
          detail={detail}
          vendor={vendor}
          totalQty={totalQty}
          receivedQty={receivedQty}
        />
      </div>

      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title" style={{ color: 'var(--blue)', textTransform: 'uppercase' }}>PO Line Items ({detail.lines.length})</div>
        </div>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Item Code</th>
                <th>Item Name</th>
                <th>Source</th>
                <th>Qty</th>
                <th>Rate</th>
                <th style={{ color: 'var(--green)' }}>Amount</th>
                <th style={{ color: 'var(--green)' }}>Received</th>
                <th style={{ color: 'var(--red)' }}>Pending</th>
                <th>Due</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.length === 0 ? (
                <tr>
                  <td colSpan={11} className="empty-state">
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

      <RelatedDocsTabs module="purchase-orders" id={detail.id} />

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
                  <b style={{ color: priceHidden ? 'var(--text3)' : 'var(--green)' }}>
                    {priceHidden ? 'Hidden' : `₹${Math.round(totalValue).toLocaleString('en-IN')}`}
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

// Legacy L26336-26348. Cell classes mirror legacy exactly: money/qty are
// `td-ctr mono` (legacy centres them — right-aligning would be an improvement,
// not parity), Item Code is `td-code` on the <td> in var(--purple) (a real
// token with no utility class), Received is always green and Pending flips
// red/green on >0.
function LineRow(props: { line: PurchaseOrderLine }): React.JSX.Element {
  const { line: l } = props;
  // rate is null when the viewer may not see prices → hide rate + amount.
  const priceHidden = l.rate == null;
  const amount = l.qty * Number(l.rate ?? 0);
  const pending = Math.max(0, l.qty - l.receivedQty);
  return (
    <tr>
      <td className="mono fw-700" style={{ color: 'var(--blue)' }}>{l.lineNo}</td>
      <td className="td-code">
        {l.itemCode ?? l.itemCodeText ?? '—'}
      </td>
      <td style={{ color: 'var(--amber)', fontWeight: 700 }}>{l.itemName}</td>
      <td className="mono text2" style={{ fontSize: 10 }}>
        {l.sourceJcOpId ? 'JC op' : l.sourceSoLineId ? 'SO line' : '—'}
      </td>
      <td className="mono fw-700">{l.qty}</td>
      <td className="mono" style={{ fontSize: 11 }}>
        {priceHidden ? 'Hidden' : Number(l.rate) > 0 ? `₹${Number(l.rate).toFixed(2)}` : '—'}
      </td>
      <td className="mono green">
        {priceHidden ? 'Hidden' : amount > 0 ? `₹${amount.toFixed(2)}` : '—'}
      </td>
      <td className="mono green fw-700">{l.receivedQty}</td>
      <td
        className="mono"
        style={{ color: pending > 0 ? 'var(--red)' : 'var(--green)', fontWeight: 700 }}
      >
        {pending}
      </td>
      <td style={{ fontSize: 11 }}>{l.dueDate ?? '—'}</td>
      <td className="text3" style={{ fontSize: 11 }}>
        {l.lineRemarks ?? '—'}
      </td>
    </tr>
  );
}
