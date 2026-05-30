// Service PO detail. Read + Approve action for admin.

import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Check, Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useApproveServicePo, useServicePo, useSoftDeleteServicePo } from '../api';

export const servicePosDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'service-pos/$id',
  component: ServicePosDetailPage,
});

function inr(n: number): string {
  return Math.round(n).toLocaleString('en-IN');
}

function statusColor(s: string): string {
  if (s === 'approved') return 'var(--green)';
  if (s === 'pending') return 'var(--amber)';
  if (s === 'completed') return 'var(--cyan)';
  if (s === 'cancelled') return 'var(--red)';
  return 'var(--text3)';
}

function ServicePosDetailPage(): React.JSX.Element {
  const { id } = servicePosDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: po, isLoading, isError, error } = useServicePo(id);
  const { data: me } = useSession();
  const isAdmin = me?.role === 'admin';
  const approveMut = useApproveServicePo();
  const softDelete = useSoftDeleteServicePo();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (isError || !po) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/service-pos" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Service PO not found'}
          </div>
        </div>
      </div>
    );
  }

  async function onApprove(): Promise<void> {
    setActionError(null);
    try {
      await approveMut.mutateAsync(id);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Approve failed');
    }
  }

  function onDelete(): void {
    softDelete.mutate(id, {
      onSuccess: () => {
        void navigate({ to: '/service-pos', replace: true });
      },
    });
  }

  return (
    <div>
      <Link to="/service-pos" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Service POs
      </Link>

      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div
              className="td-code"
              style={{ color: 'var(--cyan)', fontSize: 16, fontWeight: 800 }}
            >
              {po.spoNo}
            </div>
            <div
              className="panel-title"
              style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 10 }}
            >
              {po.vendorName ?? po.vendorCodeText ?? '—'}
              <span
                style={{ fontWeight: 700, color: statusColor(po.status), fontSize: 12 }}
              >
                {po.status}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {po.status === 'pending' && isAdmin ? (
              <button
                type="button"
                className="btn btn-sm"
                style={{ background: 'var(--green)', color: '#fff', fontWeight: 700 }}
                disabled={approveMut.isPending}
                onClick={() => void onApprove()}
              >
                {approveMut.isPending ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Check size={13} />
                )}{' '}
                Approve
              </button>
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
          {actionError ? (
            <div
              style={{
                marginBottom: 12,
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

          <div className="form-grid form-grid-3">
            <Pair label="Date" value={po.spoDate} />
            <Pair label="Cost Center" value={po.costCenter === 'general' ? 'General' : (po.soNoText ?? '—')} />
            <Pair label="Expense Head" value={po.expenseHead} />
            <Pair label="Payment Terms" value={po.paymentTerms} />
            <Pair label="Tax Type" value={po.taxType.replace('_', '+')} />
            <Pair label="GST %" value={`${po.gstPct}%`} />
            <Pair
              label="Approved"
              value={po.approvedAt ? po.approvedAt.slice(0, 16).replace('T', ' ') : '—'}
            />
            <div className="form-grp form-full">
              <span className="form-label">Remarks</span>
              <div style={{ whiteSpace: 'pre-wrap' }}>{po.remarks ?? '—'}</div>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div className="text2" style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
              Lines
            </div>
            <table className="innovic-table">
              <thead>
                <tr>
                  <th style={{ width: 30 }}>#</th>
                  <th>Description</th>
                  <th className="td-ctr">Qty</th>
                  <th className="td-ctr">Rate</th>
                  <th className="td-ctr">Amount</th>
                </tr>
              </thead>
              <tbody>
                {po.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="td-ctr">{l.lineNo}</td>
                    <td>{l.description}</td>
                    <td className="td-ctr mono">{l.qty}</td>
                    <td className="td-ctr mono">₹{l.rate.toFixed(2)}</td>
                    <td className="td-ctr mono fw-700">₹{l.amount.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} style={{ textAlign: 'right', fontWeight: 700 }}>Subtotal</td>
                  <td className="td-ctr mono fw-700">₹{po.subtotal.toFixed(2)}</td>
                </tr>
                <tr>
                  <td colSpan={4} style={{ textAlign: 'right' }}>
                    {po.taxType === 'igst' ? 'IGST' : 'SGST+CGST'} @ {po.gstPct}%
                  </td>
                  <td className="td-ctr mono">₹{po.taxAmount.toFixed(2)}</td>
                </tr>
                <tr style={{ background: 'var(--bg4)' }}>
                  <td colSpan={4} style={{ textAlign: 'right', fontWeight: 800, fontSize: 14 }}>
                    TOTAL
                  </td>
                  <td className="td-ctr mono fw-700" style={{ fontSize: 14, color: 'var(--cyan)' }}>
                    ₹{inr(po.total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Pair({ label, value }: { label: string; value: string | number }): React.JSX.Element {
  return (
    <div className="form-grp">
      <span className="form-label">{label}</span>
      <div>{value}</div>
    </div>
  );
}
