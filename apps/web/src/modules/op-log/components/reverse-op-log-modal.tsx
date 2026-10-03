// Reverse one Operation Log entry (ADR-197).
//
// The original entry is never edited or deleted: the server adds an OPPOSITE
// entry (negative Completed / Rejected, same Log Type) and every figure built
// on the log recalculates. A reason is required (1..500). The server refuses
// with a readable message when the pieces were already used by the next op,
// an NC was raised on the entry, the Job Card / Production Order is closed, or
// the entry is already reversed — that message is shown here, in the dialog.

import { opSrNo } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useReverseOpLog } from '@/modules/op-entry/api';
import { Modal } from '@/ui/feedback';
import type { OpLogListItem } from '../api';

const REASON_MAX = 500;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="form-grp">
      <span className="form-label">{label}</span>
      <div className="mono fw-700" style={{ color: 'var(--text)' }}>
        {children}
      </div>
    </div>
  );
}

export function ReverseOpLogModal({
  row,
  onClose,
}: {
  row: OpLogListItem;
  onClose: () => void;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const reverse = useReverseOpLog();
  const trimmed = reason.trim();

  const onSubmit = (): void => {
    setErr(null);
    if (!trimmed) {
      setErr('Reason is required.');
      return;
    }
    reverse.mutate(
      { id: row.id, reason: trimmed },
      {
        onSuccess: () => onClose(),
        onError: (e) =>
          setErr(e instanceof Error ? e.message : 'Could not reverse this entry. Try again.'),
      },
    );
  };

  return (
    <Modal
      title={`Reverse ${row.logNo}`}
      size="sm"
      onClose={() => {
        if (!reverse.isPending) onClose();
      }}
      closeOnOverlayClick={false}
      footer={
        <>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={reverse.isPending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={onSubmit}
            disabled={!trimmed || reverse.isPending}
            title={!trimmed ? 'Type the reason first' : 'Add the opposite entry'}
          >
            {reverse.isPending ? <Loader2 size={14} className="animate-spin" /> : null} Reverse
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Fact label="JC No.">{row.jcNo}</Fact>
        <Fact label="Op">
          {opSrNo(row.opSeq)}
          {row.operation ? (
            <span className="text2" style={{ fontWeight: 400 }}>
              {' '}
              · {row.operation}
            </span>
          ) : null}
        </Fact>
        <Fact label="Log No.">{row.logNo}</Fact>
        <Fact label="Completed / Deviated">
          <span style={{ color: 'var(--green2)' }}>{row.qty}</span>
          <span className="text3"> / </span>
          <span style={{ color: row.rejectQty > 0 ? 'var(--red2)' : 'var(--text3)' }}>
            {row.rejectQty}
          </span>
        </Fact>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6, marginTop: 10 }}>
        The original entry stays; an opposite entry is added and quantities recalculate.
      </div>

      <div className="form-grp" style={{ marginTop: 14 }}>
        <label className="form-label" htmlFor="op-log-reverse-reason">
          Reason<span className="req">★</span>
        </label>
        <textarea
          id="op-log-reverse-reason"
          className="innovic-input"
          rows={3}
          maxLength={REASON_MAX}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this entry being reversed?"
        />
      </div>

      {err ? (
        <div role="alert" className="form-error" style={{ marginTop: 8 }}>
          {err}
        </div>
      ) : null}
    </Modal>
  );
}
