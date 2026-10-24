// ADR-253 — approval of a NEW Route Card, on its detail page: the Approve /
// Reject buttons (pending card + Approve tick on Route Card Master — the
// creator included), their two dialogs, the pending / rejected banner and the
// "Approved by X on <date>" line. The server re-checks every decision; a 409
// (already decided, no right …) is thrown and the dialog shows it as-is.

import type { RouteCardDetail } from '@innovic/shared';
import { Check, X } from 'lucide-react';
import { useState } from 'react';
import { fmtDate } from '@/lib/date';
import { Banner, ConfirmDialog } from '@/ui/feedback';
import { useApproveRouteCard, useRejectRouteCard } from '../api';

const BOX_STYLE: React.CSSProperties = { display: 'block', width: '100%', marginTop: 8 };

/** "Approved by X on <date>" / "Rejected by X on <date> — <reason>". */
export function rcApprovalLine(rc: RouteCardDetail): string {
  if (rc.approvalStatus === 'approved') {
    return `Approved by ${rc.approvedByName ?? '—'} on ${rc.approvedAt ? fmtDate(rc.approvedAt) : '—'}`;
  }
  if (rc.approvalStatus === 'rejected') {
    const base = `Rejected by ${rc.rejectedByName ?? '—'} on ${rc.rejectedAt ? fmtDate(rc.rejectedAt) : '—'}`;
    return rc.rejectionReason ? `${base} — ${rc.rejectionReason}` : base;
  }
  return 'Pending Approval';
}

/** The pending / rejected notice under the header. Nothing for an approved card. */
export function RcApprovalBanner({
  detail,
}: {
  detail: RouteCardDetail;
}): React.JSX.Element | null {
  if (detail.approvalStatus === 'approved') return null;
  return (
    <div style={{ marginBottom: 'var(--panel-gap)' }}>
      {detail.approvalStatus === 'pending' ? (
        <Banner tone="warn" role="status" flush>
          Waiting for approval — this Route Card cannot be used for a Production Order until
          approved.
        </Banner>
      ) : (
        <Banner tone="error" role="status" flush>
          Rejected{detail.rejectionReason ? ` — ${detail.rejectionReason}` : ''}. Edit and save to
          send it again.
        </Banner>
      )}
    </div>
  );
}

export function RcApprovalActions({
  detail,
  canApprove,
}: {
  detail: RouteCardDetail;
  /** effectiveFormPerms(eff, 'routecard_create').approve */
  canApprove: boolean;
}): React.JSX.Element | null {
  const approveMut = useApproveRouteCard();
  const rejectMut = useRejectRouteCard();
  const [approveOpen, setApproveOpen] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (detail.approvalStatus !== 'pending' || !canApprove) return null;
  const busy = approveMut.isPending || rejectMut.isPending;

  return (
    <>
      <button
        type="button"
        className="btn btn-success"
        disabled={busy}
        onClick={() => {
          setRemarks('');
          setApproveOpen(true);
        }}
      >
        <Check size={13} /> Approve
      </button>
      <button
        type="button"
        className="btn btn-danger"
        disabled={busy}
        onClick={() => {
          setReason('');
          setRejectOpen(true);
        }}
      >
        <X size={13} /> Reject
      </button>

      <ConfirmDialog
        open={approveOpen}
        tone="primary"
        title={`Approve Route Card ${detail.code}?`}
        message={
          <>
            Once approved, this card can be used for a Production Order.
            <textarea
              className="innovic-input"
              aria-label="Approval Remarks"
              placeholder="Approval Remarks (optional)"
              rows={2}
              maxLength={500}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              style={BOX_STYLE}
            />
          </>
        }
        confirmLabel="Approve"
        pendingLabel="Approving…"
        onCancel={() => setApproveOpen(false)}
        onConfirm={async () => {
          const r = remarks.trim();
          await approveMut.mutateAsync({
            id: detail.id,
            expectedUpdatedAt: detail.updatedAt,
            ...(r ? { remarks: r } : {}),
          });
          setApproveOpen(false);
        }}
      />

      <ConfirmDialog
        open={rejectOpen}
        title={`Reject Route Card ${detail.code}?`}
        message={
          <>
            The card can be edited and saved to send it for approval again.
            <textarea
              className="innovic-input"
              aria-label="Rejection Reason"
              placeholder="Rejection Reason (required)"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={BOX_STYLE}
            />
          </>
        }
        confirmLabel="Reject"
        pendingLabel="Rejecting…"
        onCancel={() => setRejectOpen(false)}
        onConfirm={async () => {
          const r = reason.trim();
          // Thrown, not returned: the dialog shows it and stays open.
          if (!r) throw new Error('Enter a Rejection Reason.');
          await rejectMut.mutateAsync({
            id: detail.id,
            reason: r,
            expectedUpdatedAt: detail.updatedAt,
          });
          setRejectOpen(false);
        }}
      />
    </>
  );
}
