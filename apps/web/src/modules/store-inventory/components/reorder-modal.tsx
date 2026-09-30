// Reorder Level + Reorder Qty of one item (ADR-193 phase 5; was "Min Qty").
// Below Reorder = Available + On PO under the Reorder Level. A reorder buys the
// Reorder Qty, or the shortfall to the level if that is more. Decimals only
// for KGS / MTR items — the server checks the UOM.
import type { StoreInventoryRow } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useSetReorder } from '../api';
import { ModalShell } from './modal-shell';

const WHOLE = new Set(['NOS', 'SET']);
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Same rule as the server's Reorder List (P44 / P45). */
export function suggestedReorderQty(row: StoreInventoryRow): number {
  const short = row.reorderLevel - (row.availableQty + row.onPoQty);
  const q = Math.max(row.reorderQty, short, 0);
  return WHOLE.has(row.uom) ? Math.ceil(q) : r3(q);
}

export function ReorderModal({
  row,
  onClose,
}: {
  row: StoreInventoryRow;
  onClose: () => void;
}): React.JSX.Element {
  const [level, setLevel] = useState(String(row.reorderLevel));
  const [qty, setQty] = useState(String(row.reorderQty));
  const [err, setErr] = useState<string | null>(null);
  const mut = useSetReorder();

  const onSave = (): void => {
    setErr(null);
    const l = Number(level || 0);
    const q = Number(qty || 0);
    if (!Number.isFinite(l) || l < 0 || !Number.isFinite(q) || q < 0)
      return setErr('Reorder Level and Reorder Qty must be 0 or more.');
    if (WHOLE.has(row.uom) && (!Number.isInteger(l) || !Number.isInteger(q)))
      return setErr(`${row.uom} is counted in whole numbers.`);
    mut.mutate(
      { itemId: row.itemId, reorderLevel: r3(l), reorderQty: r3(q) },
      {
        onSuccess: () => onClose(),
        onError: (e) => setErr(e instanceof Error ? e.message : 'Could not save. Try again.'),
      },
    );
  };

  return (
    <ModalShell onClose={onClose} title={`Reorder — ${row.itemCode}`}>
      <div className="text3" style={{ fontSize: 12, marginBottom: 10 }}>
        0 = off. Available now <b className="mono">{row.availableQty}</b>, On PO{' '}
        <b className="mono">{row.onPoQty}</b>.
      </div>
      <div className="form-grid">
        <div className="form-grp">
          <label className="form-label">Reorder Level</label>
          <input
            type="number"
            min={0}
            step="any"
            className="innovic-input mono"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            onWheel={(e) => e.currentTarget.blur()}
            style={{ fontSize: 16, fontWeight: 700 }}
          />
        </div>
        <div className="form-grp">
          <label className="form-label">Reorder Qty</label>
          <input
            type="number"
            min={0}
            step="any"
            className="innovic-input mono"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            onWheel={(e) => e.currentTarget.blur()}
            style={{ fontSize: 16, fontWeight: 700 }}
            title="How much one reorder buys. 0 = buy just the shortfall."
          />
        </div>
      </div>
      {err ? <div style={{ marginTop: 12, color: 'var(--red2)', fontSize: 12 }}>{err}</div> : null}
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
            'Save'
          )}
        </button>
      </div>
    </ModalShell>
  );
}
