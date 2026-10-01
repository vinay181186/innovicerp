// ± Adjust Stock modal — manual +Add / −Remove against one item, posting through
// the AdjustStock service. Split out of routes/list.tsx (ADR-199) so that file
// stays under 400 lines. Behaviour is unchanged.

import type { AdjustStockInput, StoreInventoryRow } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useAdjustStock } from '../api';
import { ModalShell } from './modal-shell';

export function AdjustStockModal({
  row,
  onClose,
}: {
  row: StoreInventoryRow;
  onClose: () => void;
}): React.JSX.Element {
  const [direction, setDirection] = useState<'add' | 'remove'>('add');
  const [qty, setQty] = useState('');
  const [remarks, setRemarks] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const mut = useAdjustStock();

  const onSave = (): void => {
    setErr(null);
    const q = Number(qty);
    if (qty.trim() === '') {
      setErr('Quantity is required.');
      return;
    }
    if (!Number.isFinite(q) || q <= 0) {
      setErr('Quantity must be more than 0.');
      return;
    }
    if (!remarks.trim()) {
      setErr('Reason / Remarks is required.');
      return;
    }
    const input: AdjustStockInput = {
      itemId: row.itemId,
      direction,
      qty: q,
      remarks: remarks.trim(),
    };
    mut.mutate(input, {
      onSuccess: () => onClose(),
      onError: (e) => setErr(e instanceof Error ? e.message : 'Could not adjust stock. Try again.'),
    });
  };

  return (
    <ModalShell onClose={onClose} title={`Adjust Stock — ${row.itemCode}`}>
      <div
        style={{
          marginBottom: 12,
          padding: 10,
          background: 'var(--bg3)',
          borderRadius: 8,
        }}
      >
        <span className="text3" style={{ fontSize: 11 }}>
          Physical:
        </span>
        <span
          className="mono fw-700"
          style={{ fontSize: 18, color: 'var(--green2)', marginLeft: 8 }}
        >
          {row.inStock} {row.uom}
        </span>
        <span className="text3" style={{ fontSize: 11, marginLeft: 10 }}>
          Reserved{' '}
          <b className="mono" style={{ color: 'var(--purple)' }}>
            {row.reservedQty}
          </b>{' '}
          · Available{' '}
          <b className="mono" style={{ color: 'var(--cyan)' }}>
            {row.availableQty}
          </b>
        </span>
      </div>
      <div className="form-grid">
        <div className="form-grp">
          <label className="form-label">Adjustment Type</label>
          <select
            className="innovic-select"
            value={direction}
            onChange={(e) => setDirection(e.target.value as 'add' | 'remove')}
          >
            <option value="add">+ Add Stock</option>
            <option value="remove">- Remove Stock</option>
          </select>
        </div>
        <div className="form-grp">
          <label className="form-label">
            Quantity <span className="req">★</span>
          </label>
          <input
            type="number"
            min={1}
            className="innovic-input"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="0"
            style={{ fontSize: 16, fontWeight: 700 }}
          />
        </div>
        <div className="form-grp form-full">
          <label className="form-label">
            Reason / Remarks <span className="req">★</span>
          </label>
          <input
            type="text"
            className="innovic-input"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Physical count correction, damage, etc."
          />
        </div>
      </div>
      {err ? (
        <div
          style={{
            marginTop: 12,
            padding: 8,
            background: 'rgba(239,68,68,0.08)',
            color: 'var(--red2)',
            fontSize: 12,
            borderRadius: 4,
          }}
        >
          {err}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={mut.isPending}>
          {mut.isPending ? (
            <>
              <Loader2 size={14} className="inline animate-spin" /> Saving…
            </>
          ) : (
            'Adjust'
          )}
        </button>
      </div>
    </ModalShell>
  );
}
