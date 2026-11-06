// ADR-253 / ADR-277 — approval of a NEW Route Card, on its detail page: Submit
// for Approval (Draft / Rejected card, with the edit right), the Approve /
// Reject buttons (pending card + Approve tick on Route Card Master — the
// creator included), their dialogs, the draft / pending / rejected banner and
// the "Approved by X on <date>" line. The server re-checks every decision; a
// 409 (already decided, no right …) is thrown and the dialog shows it as-is.

import { Icon } from '@/ui/core';
import type { RouteCard, RouteCardDetail } from '@innovic/shared';
import {
  ROUTE_CARD_APPROVAL_LABEL,
  canEditRouteCard,
  canSubmitRouteCardStatus,
} from '@innovic/shared';
import { Check, Send } from 'lucide-react';
import { useState } from 'react';
import { fmtDate } from '@/lib/date';
import { Banner, ConfirmDialog, useToast } from '@/ui/feedback';
import { useApproveRouteCard, useRejectRouteCard, useSubmitRouteCard } from '../api';

const BOX_STYLE: React.CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 'var(--sp-2)',
};

/** "Approved by X on <date>" / "Rejected by X on <date> — <reason>". */
export function rcApprovalLine(rc: RouteCardDetail): string {
  if (rc.approvalStatus === 'approved') {
    return `Approved by ${rc.approvedByName ?? '—'} on ${rc.approvedAt ? fmtDate(rc.approvedAt) : '—'}`;
  }
  if (rc.approvalStatus === 'rejected') {
    const base = `Rejected by ${rc.rejectedByName ?? '—'} on ${rc.rejectedAt ? fmtDate(rc.rejectedAt) : '—'}`;
    return rc.rejectionReason ? `${base} — ${rc.rejectionReason}` : base;
  }
  return ROUTE_CARD_APPROVAL_LABEL[rc.approvalStatus];
}

/** ADR-277 — the toast after a save, from the status the server RETURNED. */
export function rcSavedMessage(rc: Pick<RouteCard, 'code' | 'approvalStatus'>): string {
  switch (rc.approvalStatus) {
    case 'draft':
      return `Route Card ${rc.code} saved as Draft.`;
    case 'pending':
      return `Route Card ${rc.code} saved — sent for approval.`;
    case 'rejected':
      return `Route Card ${rc.code} saved — still Rejected, not sent for approval.`;
    default:
      return `Route Card ${rc.code} saved`;
  }
}

/** ADR-277 — may this person send this card for approval? */
export function canSubmitRouteCard(
  card: Pick<RouteCard, 'approvalStatus' | 'createdBy'>,
  userId: string | null | undefined,
  rights: { entry: boolean; edit: boolean },
): boolean {
  return canSubmitRouteCardStatus(card.approvalStatus) && canEditRouteCard(card, userId, rights);
}

/** The draft / pending / rejected notice under the header. Nothing for an approved card. */
export function RcApprovalBanner({
  detail,
}: {
  detail: RouteCardDetail;
}): React.JSX.Element | null {
  if (detail.approvalStatus === 'approved') return null;
  return (
    <div style={{ marginBottom: 'var(--panel-gap)' }}>
      {detail.approvalStatus === 'draft' ? (
        <Banner tone="info" role="status" flush>
          Draft — not sent for approval. It cannot be used for a Production Order until it is
          submitted and approved.
        </Banner>
      ) : detail.approvalStatus === 'pending' ? (
        <Banner tone="warn" role="status" flush>
          Waiting for approval — this Route Card cannot be edited or used for a Production Order
          until the approver decides.
        </Banner>
      ) : (
        <Banner tone="error" role="status" flush>
          Rejected{detail.rejectionReason ? ` — ${detail.rejectionReason}` : ''}. Correct it, then
          press Save &amp; Submit.
        </Banner>
      )}
    </div>
  );
}

/** ADR-277 — "Send this card?" for the detail page's button and the list's ⋯.
 *  `card` = the row as loaded; its updatedAt goes back so a card changed since is
 *  refused (§20.4). A 409 shows inside the dialog, which stays open. */
export function RcSubmitDialog({
  card,
  onClose,
}: {
  card: Pick<RouteCard, 'id' | 'code' | 'updatedAt'> | null;
  onClose: () => void;
}): React.JSX.Element {
  const submitMut = useSubmitRouteCard();
  const toast = useToast();
  return (
    <ConfirmDialog
      open={card !== null}
      tone="primary"
      title={`Submit Route Card ${card?.code ?? ''} for approval?`}
      message="It cannot be edited or moved to Trash until the approver decides."
      confirmLabel="Submit for Approval"
      pendingLabel="Submitting…"
      onCancel={onClose}
      onConfirm={async () => {
        if (!card) return;
        const updated = await submitMut.mutateAsync({
          id: card.id,
          expectedUpdatedAt: card.updatedAt,
        });
        toast.ok(`Route Card ${updated.code} sent for approval.`);
        onClose();
      }}
    />
  );
}

/** ADR-277 — Submit for Approval on the detail page: a saved Draft / Rejected card. */
export function RcSubmitAction({
  detail,
  userId,
  rights,
}: {
  detail: RouteCardDetail;
  userId: string | null | undefined;
  /** effectiveFormPerms(eff, 'routecard_create') */
  rights: { entry: boolean; edit: boolean };
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (!canSubmitRouteCard(detail, userId, rights)) return null;
  return (
    <>
      <button type="button" className="btn btn-success" onClick={() => setOpen(true)}>
        <Send size={13} /> Submit for Approval
      </button>
      <RcSubmitDialog card={open ? detail : null} onClose={() => setOpen(false)} />
    </>
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
        <Icon name="x" size={13} /> Reject
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
            The card can be corrected, then sent again with Save &amp; Submit.
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
