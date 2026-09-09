// "Close balance" modal (ADR-152 phase 2) — the buyer formally stops expecting
// the unordered remainder of a Purchase Request.
//
// Shape lifted from the PO detail Reject modal (purchase-orders/routes/
// detail.tsx): same overlay, same `.panel` body, same required-reason textarea,
// same footer pair. Only the wording and the colour change — this is not a
// rejection, because what was already ordered STANDS.
//
// It is a separate file rather than another 120 lines inside the PR detail
// page, which is already at the 400-line limit in CLAUDE.md §12.

import { Loader2, X } from 'lucide-react';
import { useState } from 'react';
import type { PrOrderBalance } from '../lib/pr-balance';

export function CloseBalanceModal({
  code,
  bal,
  pending,
  errorText,
  onCancel,
  onSubmit,
}: {
  /** PR number, shown in the title so the buyer can see what they are closing. */
  code: string;
  bal: PrOrderBalance;
  pending: boolean;
  errorText: string | null;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  // Required, and the API + the database CHECK both require it too. Blocked in
  // the button rather than submitted-and-bounced, so the user is not told off
  // by a server error for something the form already knows.
  const canSubmit = reason.trim().length > 0 && !pending;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
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
        style={{ width: 'min(560px, 96vw)' }}
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
          <div className="fw-700" style={{ color: 'var(--amber)' }}>
            🚫 Close balance — {code}
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            <X size={14} />
          </button>
        </div>
        <div style={{ padding: 16, display: 'grid', gap: 12 }}>
          <div
            style={{
              background: 'var(--bg3)',
              padding: 12,
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 12,
              color: 'var(--text2)',
              lineHeight: 1.5,
            }}
          >
            <div>
              <b className="mono">{bal.ordered}</b> of <b className="mono">{bal.qty}</b> is on
              purchase orders. Closing the balance stops the remaining{' '}
              <b className="mono" style={{ color: 'var(--amber)' }}>
                {bal.balance}
              </b>{' '}
              from ever being ordered.
            </div>
            <div className="text3" style={{ marginTop: 6 }}>
              The request still says {bal.qty} was asked for and keeps every purchase order it
              already has — nothing is cancelled. It simply drops out of the "still to buy" list. To
              scrap the whole request instead, use Reject.
            </div>
          </div>
          <div className="form-grp">
            <label className="form-label" htmlFor="pr-close-balance-reason">
              Why is the rest not being ordered? <span className="req">★</span>
            </label>
            <textarea
              id="pr-close-balance-reason"
              className="innovic-input"
              rows={3}
              value={reason}
              autoFocus
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer cut the order to 10 pcs — balance not required"
            />
          </div>
          {errorText ? (
            <div
              style={{
                padding: '8px 12px',
                background: 'var(--red3)',
                border: '1px solid var(--sig-critical-bd)',
                borderRadius: 6,
                color: 'var(--red)',
                fontSize: 12,
              }}
            >
              {errorText}
            </div>
          ) : null}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
              Cancel
            </button>
            {/* btn-danger, like Delete: this is the irreversible half of the
                dialog. There is no amber button class and inventing one means
                editing the shared stylesheet, which this task does not open. */}
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={!canSubmit}
              onClick={() => onSubmit(reason.trim())}
            >
              {pending ? (
                <>
                  <Loader2 className="inline h-3 w-3 animate-spin" /> Closing…
                </>
              ) : (
                'Close balance'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
