// Reorder Level + Reorder Qty of one item (ADR-193 phase 5; was "Min Qty").
// Below Reorder = Available + On PO under the Reorder Level. A reorder buys the
// Reorder Qty, or the shortfall to the level if that is more. Decimals only
// for KGS / MTR items — the server checks the UOM.
import type { StoreInventoryRow } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { isStagedResult } from '@/modules/document-edits/api';
import { useToast } from '@/ui/feedback';
import { useItemStockTotals, useSetReorder } from '../api';
import { ModalShell } from './modal-shell';

const WHOLE = new Set(['NOS', 'SET']);
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Same rule as the server's Reorder List (P44 / P45). Pass ITEM totals for
 *  availableQty / onPoQty (sumItemStock) — one Rev row is not the item. */
export function suggestedReorderQty(
  row: Pick<StoreInventoryRow, 'reorderLevel' | 'reorderQty' | 'availableQty' | 'onPoQty' | 'uom'>,
): number {
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
  const toast = useToast();
  const mut = useSetReorder();
  // Reorder is item-level: Available and On PO are the ITEM's, added up over
  // all its Drawing Rev rows — the row this box was opened from may be one
  // Rev bucket only (and On PO sits on the item's reorder row alone).
  const { totals } = useItemStockTotals(row.itemId, row.itemCode);

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
        onSuccess: (res) => {
          // ADR-249 Step B — the change was held for approval: the item still
          // carries its old Reorder Level / Qty, so the toast says so.
          toast.ok(
            isStagedResult(res)
              ? 'Sent for approval — your changes will apply once an approver signs off.'
              : `Reorder for ${row.itemCode} saved`,
          );
          onClose();
        },
        onError: (e) => setErr(e instanceof Error ? e.message : 'Could not save. Try again.'),
      },
    );
  };

  return (
    <ModalShell
      onClose={onClose}
      title={`Reorder — ${row.itemCode}`}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onSave}
            disabled={mut.isPending}
          >
            {mut.isPending ? (
              <>
                <Loader2 size={14} className="inline animate-spin" /> Saving…
              </>
            ) : (
              'Save'
            )}
          </button>
        </>
      }
    >
      <div className="text3" style={{ fontSize: 'var(--fs-xs)', marginBottom: 10 }}>
        0 = off. Available now (all Drawing Revs){' '}
        <b className="mono">{totals ? totals.availableQty : '…'}</b>, On PO{' '}
        <b className="mono">{totals ? totals.onPoQty : '…'}</b>.
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
            style={{ fontSize: 'var(--fs-md)', fontWeight: 700 }}
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
            style={{ fontSize: 'var(--fs-md)', fontWeight: 700 }}
            title="How much one reorder buys. 0 = buy just the shortfall."
          />
        </div>
      </div>
      {err ? (
        <div style={{ marginTop: 'var(--sp-3)', color: 'var(--red2)', fontSize: 'var(--fs-sm)' }}>
          {err}
        </div>
      ) : null}
    </ModalShell>
  );
}
