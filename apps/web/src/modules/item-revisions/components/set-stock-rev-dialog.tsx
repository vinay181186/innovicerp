// "Set Rev" on old stock (Drawing Rev Fix List, Phase D). Stock of a MAKE item
// made before the register sits in a blank bucket with no Drawing Rev; the
// store moves some or all of it onto one Item + Rev (ABC/1). The server posts
// an out + in pair in the stock ledger (source 'rev_change') and checks the
// qty against what is really in the blank bucket.

import type { FixListStock } from '@innovic/shared';
import { itemRevLabel } from '@innovic/shared';
import { useState } from 'react';
import { useSaveKey } from '@/lib/use-save-key';
import { ConfirmDialog } from '@/ui/feedback';
import { FormField, SearchableSelect } from '@/ui/forms';
import { useSetStockRev } from '../api';

export function SetStockRevDialog({
  row,
  onClose,
}: {
  row: FixListStock;
  onClose: () => void;
}): React.JSX.Element {
  const saveKey = useSaveKey();
  const setRev = useSetStockRev(saveKey);
  const [revId, setRevId] = useState<string | null>(
    row.knownRevs.length === 1 ? (row.knownRevs[0]?.itemRevisionId ?? null) : null,
  );
  const [qty, setQty] = useState(String(row.onHandQty));
  const [remarks, setRemarks] = useState('');
  const options = row.knownRevs.map((r) => ({
    id: r.itemRevisionId,
    code: itemRevLabel(row.itemCode, r.drawingRev),
    name: '',
  }));

  return (
    <ConfirmDialog
      title={`Set Drawing Rev — ${row.itemCode} · no Rev`}
      tone="primary"
      confirmLabel="Set Rev"
      pendingLabel="Saving…"
      message={
        <div style={{ display: 'grid', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
          <span>
            Old stock without a Drawing Rev: <b className="mono">{row.onHandQty}</b>. The qty moved
            here is counted under the Drawing Rev you pick.
          </span>
          <FormField label="Drawing Rev" required htmlFor="fix-set-rev">
            <SearchableSelect
              id="fix-set-rev"
              value={revId}
              onChange={setRevId}
              options={options}
              placeholder="Select Drawing Rev…"
              emptyText="No Drawing Rev known for this item"
              selectedLabel={(o) => o.code ?? o.name}
            />
          </FormField>
          <FormField label="Qty" required htmlFor="fix-set-qty">
            <input
              id="fix-set-qty"
              type="number"
              className="innovic-input mono"
              style={{ maxWidth: '12ch' }}
              min={0}
              max={row.onHandQty}
              step="any"
              value={qty}
              onWheel={(e) => (e.target as HTMLInputElement).blur()}
              onChange={(e) => setQty(e.target.value)}
            />
          </FormField>
          <FormField label="Remarks" htmlFor="fix-set-remarks">
            <input
              id="fix-set-remarks"
              className="innovic-input"
              maxLength={500}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="e.g. checked the parts against drawing Rev 1"
            />
          </FormField>
        </div>
      }
      onCancel={onClose}
      onConfirm={async () => {
        // Thrown, not returned: ConfirmDialog shows it and stays open.
        if (!revId) throw new Error('Drawing Rev is required.');
        const q = Number(qty);
        if (qty.trim() === '' || !Number.isFinite(q) || q <= 0) {
          throw new Error('Qty must be more than 0.');
        }
        if (q > row.onHandQty) {
          throw new Error(`Qty cannot be more than the old stock (${row.onHandQty}).`);
        }
        await setRev.mutateAsync({
          itemId: row.itemId,
          itemRevisionId: revId,
          qty: q,
          ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
        });
        onClose();
      }}
    />
  );
}
