// ADR-235 — the ONE Cancel dialog every enrolled document opens (Phase A:
// Invoice, JW Invoice, Customer Dispatch). It never decides anything itself:
// the server's preview says what Cancel would do, what blocks it, whether a
// request is already open, and which buttons this user may press.
//
// States, in the order they are checked:
//   loading → preview failed → already Cancelled → request pending →
//   BLOCKED (documents made from it — no reason box, no button) →
//   READY (effects + reason + Keep / Request cancel / Cancel now) →
//   SENT (request waiting for approval).
//
// ONE-STEP documents (owner rule 2026-10-31): a Purchase Request needs no
// approval, so its READY state offers a single "Cancel PR" (reason → Cancelled
// at once, sent with approveNow). An old request still pending on a PR keeps
// the pending state below. Every other document keeps request + approve.
//
// Double-click (CLAUDE.md §20.1 / §20.2): a ref flips the INSTANT a button is
// pressed, before React re-renders, and every button is disabled while a call
// is in flight. The server's conditional status update is the real guard.

import {
  CANCEL_DOC_LABELS,
  type CancelDocType,
  type CancelRequestResult,
  ONE_STEP_CANCEL_DOC_TYPES,
} from '@innovic/shared';
import { useRef, useState } from 'react';
import { fmtDateTime } from '@/lib/date';
import { useSession } from '@/lib/session';
import { ApprovalRejectDialog } from '@/modules/approvals/components/approval-reject-dialog';
import { Modal } from '@/ui/feedback';
import { useCancelPreview, useDecideCancel, useRequestCancel, useWithdrawCancel } from '../api';
import { BlockerList, CancelError, EffectsList } from './cancel-doc-parts';

const TEXT: React.CSSProperties = { fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 };

export function CancelDocDialog({
  docType,
  docId,
  docCode,
  onClose,
}: {
  docType: CancelDocType;
  docId: string;
  docCode: string;
  onClose: () => void;
}): React.JSX.Element {
  const preview = useCancelPreview(docType, docId);
  const { data: me } = useSession();
  const requestMut = useRequestCancel();
  const decideMut = useDecideCancel();
  const withdrawMut = useWithdrawCancel();
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [sent, setSent] = useState<CancelRequestResult | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const inFlight = useRef(false);
  // One-step type (shared ONE_STEP_CANCEL_DOC_TYPES, the server's own list):
  // the Edit tick cancels at once — no request / approval wording.
  const oneStepLabel = ONE_STEP_CANCEL_DOC_TYPES.includes(docType)
    ? `Cancel ${CANCEL_DOC_LABELS[docType]}`
    : null;
  const busy = requestMut.isPending || decideMut.isPending || withdrawMut.isPending;

  /** One call at a time; close when the document is now Cancelled or the
   *  request was withdrawn / decided, otherwise show the SENT state. */
  async function run(
    fn: () => Promise<CancelRequestResult>,
    after: 'close' | 'sent' = 'close',
  ): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setErr(null);
    try {
      const res = await fn();
      if (after === 'sent' && !res.cancelled) setSent(res);
      else onClose();
    } catch (e) {
      setErr(e);
      void preview.refetch();
    } finally {
      inFlight.current = false;
    }
  }

  const p = preview.data;
  const trimmed = reason.trim();
  const btnClose = (label = 'Close') => (
    <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
      {label}
    </button>
  );

  let title = `Cancel ${docCode}`;
  let body: React.ReactNode;
  let footer: React.ReactNode = btnClose();

  if (sent) {
    title = 'Cancel Request sent';
    body = (
      <div style={TEXT}>
        The Cancel Request for <b className="mono">{docCode}</b> is waiting for approval. Someone
        with the Approve tick on this page decides it in Settings → Approvals → Cancel Requests.
        Until then {docCode} stays as it is.
      </div>
    );
  } else if (preview.isLoading) {
    body = <div style={TEXT}>Checking what cancelling {docCode} would do…</div>;
  } else if (preview.isError || !p) {
    body = <CancelError error={preview.error ?? new Error('Could not check this document.')} />;
  } else if (p.alreadyCancelled) {
    body = (
      <div style={TEXT}>
        <b className="mono">{docCode}</b> is already{' '}
        <b style={{ color: 'var(--red2)' }}>Cancelled</b>. Nothing to do.
      </div>
    );
  } else if (p.pending) {
    const r = p.pending;
    const mine = !!me && r.requestedBy === me.id;
    title = `Cancel Request — ${docCode}`;
    body = (
      <div style={TEXT}>
        <div>
          A Cancel Request for <b className="mono">{docCode}</b> is waiting for approval.
        </div>
        <div style={{ marginTop: 'var(--sp-2)' }}>
          Requested by <b>{r.requestedByName ?? '—'}</b> on {fmtDateTime(r.requestedAt)}
        </div>
        <div>
          Reason: <b>{r.reason}</b>
        </div>
        <CancelError error={err} />
      </div>
    );
    footer = (
      <>
        {btnClose()}
        {mine ? (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => void run(() => withdrawMut.mutateAsync({ id: r.id }))}
          >
            Withdraw
          </button>
        ) : null}
        {p.canApprove ? (
          <>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => setRejecting(true)}
            >
              Reject
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() =>
                void run(() => decideMut.mutateAsync({ id: r.id, decision: 'approve' }))
              }
            >
              {decideMut.isPending ? 'Cancelling…' : 'Approve — Cancel now'}
            </button>
          </>
        ) : null}
      </>
    );
  } else if (p.blockers.length > 0) {
    body = (
      <div style={TEXT}>
        <div>
          ⛔ <b className="mono">{docCode}</b> can&apos;t be cancelled yet — other documents have
          been made from it. Cancel them first, in this order:
        </div>
        <BlockerList blockers={p.blockers} />
      </div>
    );
  } else if (!p.canRequest) {
    // A request needs the Edit tick (the server checks it first); an Approve-only
    // holder decides requests others raise (the pending state above).
    body = (
      <div style={TEXT}>
        {oneStepLabel
          ? 'You need the Edit tick on this page to cancel it. Ask an admin for the right.'
          : 'You need the Edit tick on this page to ask for a cancel. Ask an admin for the right.'}
      </div>
    );
  } else {
    title = `Cancel ${docCode}?`;
    body = (
      <div style={TEXT}>
        <div>
          {p.effects.length > 0
            ? 'Cancelling it will:'
            : `${docCode} stays on record, marked Cancelled.`}
        </div>
        <EffectsList effects={p.effects} />
        <div className="form-grp" style={{ marginTop: 'var(--sp-3)' }}>
          <label className="form-label" htmlFor="cancel-doc-reason">
            Reason<span className="req">★</span>
          </label>
          <textarea
            id="cancel-doc-reason"
            className="innovic-input"
            rows={3}
            maxLength={500}
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={`Why is ${docCode} being cancelled?`}
          />
        </div>
        {!p.canApprove && !oneStepLabel ? (
          <div className="text3" style={{ fontSize: 11 }}>
            A holder of the Approve tick on this page approves it before {docCode} is cancelled.
          </div>
        ) : null}
        <CancelError error={err} />
      </div>
    );
    const send = (approveNow: boolean) =>
      void run(
        () => requestMut.mutateAsync({ docType, docId, reason: trimmed, approveNow }),
        'sent',
      );
    footer = oneStepLabel ? (
      <>
        {btnClose('Keep')}
        <button
          type="button"
          className="btn btn-danger"
          disabled={!trimmed || busy}
          title={!trimmed ? 'Type the reason first' : undefined}
          onClick={() => send(true)}
        >
          {requestMut.isPending ? 'Cancelling…' : oneStepLabel}
        </button>
      </>
    ) : (
      <>
        {btnClose('Keep')}
        {p.canRequest ? (
          <button
            type="button"
            className={p.canApprove ? 'btn btn-ghost' : 'btn btn-danger'}
            disabled={!trimmed || busy}
            title={!trimmed ? 'Type the reason first' : 'Send for approval'}
            onClick={() => send(false)}
          >
            {requestMut.isPending ? 'Sending…' : 'Request cancel'}
          </button>
        ) : null}
        {p.canApprove ? (
          <button
            type="button"
            className="btn btn-danger"
            disabled={!trimmed || busy}
            title={!trimmed ? 'Type the reason first' : 'Request and approve at once'}
            onClick={() => send(true)}
          >
            {requestMut.isPending ? 'Cancelling…' : 'Cancel now'}
          </button>
        ) : null}
      </>
    );
  }

  return (
    <>
      <Modal
        title={title}
        size="sm"
        closeOnOverlayClick={false}
        onClose={() => {
          if (!busy) onClose();
        }}
        footer={footer}
      >
        {body}
      </Modal>
      {rejecting && p?.pending ? (
        <ApprovalRejectDialog
          title={`Reject Cancel Request — ${docCode}`}
          prompt="Why is this Cancel Request rejected?"
          onCancel={() => setRejecting(false)}
          onReject={(note) => {
            const id = p.pending?.id;
            setRejecting(false);
            if (id) void run(() => decideMut.mutateAsync({ id, decision: 'reject', note }));
          }}
        />
      ) : null}
    </>
  );
}
