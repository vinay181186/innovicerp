// Manual Receipt modal (legacy storeReceiveManual, HTML L24981) — manual stock
// IN entry. The underlying ledger writes `source_type='manual_adjust'` via the
// existing AdjustStock service; the "Source" dropdown is sent as its own `source`
// field (the server refuses 'purchase'), and the Ref No + remarks stay free text.
//
// The Item is picked from the whole Item Master (shared type-to-search), not from
// the rows on the inventory page. 'Purchase' is NOT a source here: bought material
// comes in through a GRN (PO link + incoming QC); the server refuses it too.
//
// Split out of routes/list.tsx (ADR-199) so that file stays under 400 lines.
// Behaviour is unchanged.

import type { AdjustStockInput, ManualReceiptSource } from '@innovic/shared';
import { MANUAL_RECEIPT_SOURCE_LABEL } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SearchableSelect } from '@/ui/forms';
import { useItemsList } from '@/modules/items/api';
import { useAdjustStock, useStoreInventory } from '../api';
import { useDiscardGuard } from './discard-guard';
import { ModalShell } from './modal-shell';

/** Sources a Manual Receipt may pick — every one but Purchase (GRN only). */
const RECEIPT_SOURCES: ReadonlyArray<Exclude<ManualReceiptSource, 'purchase'>> = [
  'production',
  'return',
  'other',
];

export function ManualReceiptModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [itemId, setItemId] = useState<string | null>(null);
  const [itemSearch, setItemSearch] = useState('');
  const [qty, setQty] = useState('');
  const [source, setSource] = useState<Exclude<ManualReceiptSource, 'purchase'>>('production');
  const [refNo, setRefNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const mut = useAdjustStock();

  const { data: itemsData, isFetching: itemsFetching } = useItemsList({
    search: itemSearch.trim() || undefined,
    limit: 50,
    offset: 0,
  });
  // Remember the picked item so its code / UOM stay shown after the search changes.
  const [picked, setPicked] = useState<{ code: string; name: string; uom: string | null } | null>(
    null,
  );
  const itemOptions = useMemo(
    () => (itemsData?.items ?? []).map((it) => ({ id: it.id, code: it.code, name: it.name })),
    [itemsData],
  );
  // Current stock of the picked item, whatever the inventory page's filter is.
  const { data: stockData } = useStoreInventory(
    { search: picked?.code ?? '', filter: 'all' },
    Boolean(picked),
  );
  const stockRow = picked ? (stockData?.rows ?? []).find((r) => r.itemId === itemId) : undefined;

  const dirty = Boolean(itemId || qty.trim() || refNo.trim() || remarks.trim());
  const guard = useDiscardGuard(dirty, onClose);

  const onSave = (): void => {
    setErr(null);
    if (!itemId) {
      setErr('Item is required.');
      return;
    }
    const q = Number(qty);
    if (qty.trim() === '') {
      setErr('Quantity is required.');
      return;
    }
    if (!Number.isFinite(q) || q <= 0) {
      setErr('Quantity must be more than 0.');
      return;
    }
    const composedRemarks = [
      'Manual receipt',
      refNo.trim() ? `ref=${refNo.trim()}` : null,
      remarks.trim() || null,
    ]
      .filter(Boolean)
      .join(' · ');

    const input: AdjustStockInput = {
      itemId,
      direction: 'add',
      qty: q,
      remarks: composedRemarks,
      source,
    };
    mut.mutate(input, {
      onSuccess: () => onClose(),
      onError: (e) => setErr(e instanceof Error ? e.message : 'Could not save receipt. Try again.'),
    });
  };

  return (
    <ModalShell onClose={guard.requestClose} title="Manual Receipt">
      {guard.dialog}
      <div className="form-grid">
        <div className="form-grp">
          <label className="form-label" htmlFor="mr-item">
            Item <span className="req">★</span>
          </label>
          <SearchableSelect
            id="mr-item"
            value={itemId}
            onChange={(id) => {
              setItemId(id);
              const it = itemsData?.items.find((x) => x.id === id);
              setPicked(it ? { code: it.code, name: it.name, uom: it.uom ?? null } : null);
            }}
            options={itemOptions}
            valueLabel={picked ? `${picked.code} — ${picked.name}` : undefined}
            onSearch={setItemSearch}
            loading={itemsFetching}
            placeholder="Type item code or name…"
            emptyText="No matching item"
          />
          {picked ? (
            <div className="text3" style={{ fontSize: 11, marginTop: 4 }}>
              In stock now: {stockRow ? stockRow.inStock : '—'} {picked.uom ?? ''}
            </div>
          ) : null}
        </div>
        <div className="form-grp">
          <label className="form-label">
            Quantity <span className="req">★</span>
            {picked?.uom ? <span className="text3"> ({picked.uom})</span> : null}
          </label>
          <input
            type="number"
            min={0}
            step="any"
            className="innovic-input"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            onWheel={(e) => e.currentTarget.blur()}
            placeholder="0"
            style={{ fontSize: 16, fontWeight: 700 }}
          />
        </div>
        <div className="form-grp">
          <label className="form-label">Source</label>
          <select
            className="innovic-select"
            value={source}
            onChange={(e) => setSource(e.target.value as Exclude<ManualReceiptSource, 'purchase'>)}
          >
            {RECEIPT_SOURCES.map((s) => (
              <option key={s} value={s}>
                {MANUAL_RECEIPT_SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
          <div className="text3" style={{ fontSize: 11, marginTop: 4 }}>
            Bought material is received through a GRN (against its PO, with incoming QC) — not here.
          </div>
        </div>
        <div className="form-grp">
          <label className="form-label">Ref No.</label>
          <input
            type="text"
            className="innovic-input"
            value={refNo}
            onChange={(e) => setRefNo(e.target.value)}
            placeholder="JC / return slip number"
          />
        </div>
        <div className="form-grp form-full">
          <label className="form-label">Remarks</label>
          <input
            type="text"
            className="innovic-input"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
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
            'Save Receipt'
          )}
        </button>
      </div>
    </ModalShell>
  );
}
