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

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '@/ui/feedback';
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
    <Modal
      title={<span style={{ color: 'var(--amber2)' }}>🚫 Short Close — {code}</span>}
      onClose={onCancel}
      size="sm"
      bodyStyle={{ display: 'grid', gap: 12 }}
      footer={
        <>
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
              'Short Close'
            )}
          </button>
        </>
      }
    >
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
        Stop ordering the pending{' '}
        <b className="mono" style={{ color: 'var(--amber2)' }}>
          {bal.balance}
        </b>
        ? Existing POs stay.
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
          placeholder="e.g. Customer cut the order to 10 pcs — rest not required"
        />
      </div>
      {errorText ? (
        <div
          style={{
            padding: '8px 12px',
            background: 'var(--red3)',
            border: '1px solid var(--sig-critical-bd)',
            borderRadius: 6,
            color: 'var(--red2)',
            fontSize: 12,
          }}
        >
          {errorText}
        </div>
      ) : null}
    </Modal>
  );
}
