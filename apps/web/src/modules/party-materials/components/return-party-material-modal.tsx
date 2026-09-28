// Return spare customer material (R7, ADR-194) — sends leftover client-owned
// material back to the customer. Capped at the current party-store balance
// (stockQty); posts a 'return' (out) row to the party stock ledger and bumps
// returnedQty. A qty and a reason are required. Reuses jw_create server-side.

import type { PartyMaterialListItem, ReturnPartyMaterialInput } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useReturnPartyMaterial } from '../api';

export function ReturnPartyMaterialModal({
  row,
  onClose,
}: {
  row: PartyMaterialListItem;
  onClose: () => void;
}): React.JSX.Element {
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const returnMut = useReturnPartyMaterial();

  const onConfirm = (): void => {
    setErr(null);
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) {
      setErr('Return qty must be 1 or more.');
      return;
    }
    if (q > row.stockQty) {
      setErr(`Only ${row.stockQty} in the party store — cannot return more.`);
      return;
    }
    if (!reason.trim()) {
      setErr('Give a reason — it is stored on the ledger entry.');
      return;
    }
    const input: { id: string } & ReturnPartyMaterialInput = {
      id: row.id,
      qty: q,
      reason: reason.trim(),
    };
    returnMut.mutate(input, {
      onSuccess: () => onClose(),
      onError: (e) =>
        setErr(e instanceof Error ? e.message : 'Could not return the material. Try again.'),
    });
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 20,
          width: 'min(520px, 94vw)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 12 }}>
          ↩ Return {row.code} — {row.name}
        </div>
        <div className="text2" style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.6 }}>
          In the party store now: <b style={{ color: 'var(--green2)' }}>{row.stockQty}</b>{' '}
          {row.uom}. Returning removes it from party stock and records it on the party ledger.
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="pm-return-qty">
            Return Qty<span className="req">★</span>
          </label>
          <input
            id="pm-return-qty"
            type="number"
            min={1}
            max={row.stockQty}
            className="innovic-input"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="0"
            style={{ fontWeight: 700, textAlign: 'right' }}
            autoFocus
          />
        </div>
        <div className="form-grp" style={{ marginTop: 10 }}>
          <label className="form-label" htmlFor="pm-return-reason">
            Reason<span className="req">★</span>
          </label>
          <input
            id="pm-return-reason"
            type="text"
            className="innovic-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. surplus material returned to customer"
          />
        </div>
        {err ? (
          <div
            style={{
              marginTop: 12,
              color: 'var(--red2)',
              background: 'var(--red3)',
              border: '1px solid var(--red)',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 12,
            }}
          >
            {err}
          </div>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
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
                <Loader2 size={14} className="inline animate-spin" /> Returning…
              </>
            ) : (
              'Return Material'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
