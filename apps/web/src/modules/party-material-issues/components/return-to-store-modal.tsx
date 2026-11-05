// Return to Store (ADR-203) — puts unused customer material back from a Job
// Card into the customer-material register. Partial: Qty + Reason. The server
// caps the qty at what is still physically on the Job Card (issued − already
// returned − used by the first operation, good + rejected) and says so when
// the entry is over; the screen only checks the obvious upper bound.

import { type PartyMaterialIssueListItem } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Modal, useToast } from '@/ui/feedback';
import { useReturnPartyMaterialIssueToStore } from '../api';
import { Field } from './modal-field';

export function ReturnToStoreModal({
  row,
  onClose,
}: {
  row: PartyMaterialIssueListItem;
  onClose: () => void;
}): React.JSX.Element {
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const returnMut = useReturnPartyMaterialIssueToStore();
  const notYetReturned = row.qty - row.returnedToStoreQty;
  const toast = useToast();

  const onConfirm = (): void => {
    setErr(null);
    const q = Number(qty);
    if (!Number.isInteger(q) || q <= 0) {
      setErr('Return Qty must be a whole number, 1 or more.');
      return;
    }
    if (q > notYetReturned) {
      setErr(`At most ${notYetReturned} can come back on this issue.`);
      return;
    }
    if (!reason.trim()) {
      setErr('Give a reason — it is stored on the return.');
      return;
    }
    returnMut.mutate(
      { id: row.id, qty: q, reason: reason.trim() },
      {
        onSuccess: () => {
          toast.ok(`${q} returned to store on ${row.code}`);
          onClose();
        },
        onError: (e) =>
          setErr(e instanceof Error ? e.message : 'Could not return to store. Try again.'),
      },
    );
  };

  return (
    <Modal
      title={<>Return to Store — {row.code}</>}
      onClose={onClose}
      maxWidth="min(520px, 94vw)"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={returnMut.isPending}
            onClick={onConfirm}
          >
            {returnMut.isPending ? (
              <>
                <Loader2 size={14} className="inline animate-spin" /> Saving…
              </>
            ) : (
              'Return to Store'
            )}
          </button>
        </>
      }
    >
      <div
        className="text2"
        style={{ fontSize: 'var(--fs-sm)', marginBottom: 'var(--sp-3)', lineHeight: 1.6 }}
      >
        JC <span className="mono fw-700">{row.jcCodeText ?? '—'}</span> · Customer RM{' '}
        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
          {row.partyMaterialCodeText ?? '—'}
        </span>
        <br />
        Issued <b>{row.qty}</b>
        {row.returnedToStoreQty > 0 ? (
          <>
            {' '}
            · already returned <b>{row.returnedToStoreQty}</b>
          </>
        ) : null}
        . Pieces already used on the Job Card cannot come back.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 'var(--sp-3)' }}>
        <Field label="Return Qty" required>
          <input
            type="number"
            min={1}
            step={1}
            className="innovic-input"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="0"
            autoFocus
            style={{ maxWidth: '12ch' }}
          />
        </Field>
        <Field label="Reason" required>
          <input
            type="text"
            className="innovic-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. job finished, spare pieces"
          />
        </Field>
      </div>
      {err ? (
        <div
          style={{
            marginTop: 'var(--sp-3)',
            padding: 'var(--sp-2)',
            background: 'var(--red3)',
            color: 'var(--red2)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--fs-sm)',
          }}
        >
          {err}
        </div>
      ) : null}
    </Modal>
  );
}
