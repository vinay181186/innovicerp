// ± Adjust Stock modal — manual +Add / −Remove against one item, posting through
// the AdjustStock service. Split out of routes/list.tsx (ADR-199) so that file
// stays under 400 lines. Behaviour is unchanged.

import type { AdjustStockInput, StoreInventoryRow } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import {
  DrawingRevPicker,
  NO_REV_OPTION,
  pickedRevisionId,
  useItemRevOptions,
} from '@/modules/item-revisions/components/drawing-rev-picker';
import { useAdjustStock, useItemRevStock } from '../api';
import { ModalShell } from './modal-shell';
import { useToast } from '@/ui/feedback';

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
  // Phase C — a MAKE item with Revs is adjusted per Item + Drawing Rev bucket.
  // The Store row IS one bucket, so its Rev comes pre-selected: the row's own
  // Drawing Rev, or "No Rev (old stock)" for the blank row. (Ignored for an
  // item with no Revs — the picker is not shown and nothing is sent.)
  const [revValue, setRevValue] = useState<string | null>(row.itemRevisionId ?? NO_REV_OPTION);
  const revOpts = useItemRevOptions(row.itemId);
  const toast = useToast();
  const mut = useAdjustStock();
  // The figures shown are those of the bucket being adjusted. The Store row is
  // one bucket, but the picker may move to another Rev — so for an item with
  // Revs read the item's per-Rev stock and show the PICKED bucket (a bucket
  // with nothing in it is not listed → 0). No Revs → the row is the item.
  const revStock = useItemRevStock(revOpts.required ? row.itemId : null);
  const shown = ((): { inStock: number; reservedQty: number; availableQty: number } | null => {
    if (!revOpts.required) return row;
    if (!revValue) return null;
    if (!revStock.data) return null;
    const want = pickedRevisionId(revValue);
    const b = revStock.data.find((r) => (r.itemRevisionId ?? null) === want);
    return b
      ? { inStock: b.onHandQty, reservedQty: b.reservedQty, availableQty: b.freeQty }
      : { inStock: 0, reservedQty: 0, availableQty: 0 };
  })();

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
    if (revOpts.required && !revValue) {
      setErr('Drawing Rev is required.');
      return;
    }
    const input: AdjustStockInput = {
      itemId: row.itemId,
      ...(revOpts.required ? { itemRevisionId: pickedRevisionId(revValue) } : {}),
      direction,
      qty: q,
      remarks: remarks.trim(),
    };
    mut.mutate(input, {
      onSuccess: () => {
        toast.ok(`Stock adjusted — ${row.itemLabel}`);
        onClose();
      },
      onError: (e) => setErr(e instanceof Error ? e.message : 'Could not adjust stock. Try again.'),
    });
  };

  return (
    <ModalShell
      onClose={onClose}
      title={`Adjust Stock — ${row.itemLabel}`}
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
              'Adjust'
            )}
          </button>
        </>
      }
    >
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
          {shown ? shown.inStock : '—'} {row.uom}
        </span>
        <span className="text3" style={{ fontSize: 11, marginLeft: 10 }}>
          Reserved{' '}
          <b className="mono" style={{ color: 'var(--purple)' }}>
            {shown ? shown.reservedQty : '—'}
          </b>{' '}
          · Available{' '}
          <b className="mono" style={{ color: 'var(--cyan)' }}>
            {shown ? shown.availableQty : '—'}
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
        {revOpts.required ? (
          <div className="form-grp">
            <label className="form-label" htmlFor="adjust-drawing-rev">
              Drawing Rev <span className="req">★</span>
            </label>
            <DrawingRevPicker
              id="adjust-drawing-rev"
              itemId={row.itemId}
              value={revValue}
              onChange={setRevValue}
            />
          </div>
        ) : null}
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
    </ModalShell>
  );
}
