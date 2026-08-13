// Dispatch line editor — the SO Master line-item table
// (sales-orders/components/sales-order-form.tsx L815-913), not the hand-rolled
// CSS grid this replaced. That grid pinned seven columns to fixed px widths and
// carried no wrapper, so below ~900px it pushed the whole app sideways; the
// per-line error was aligned with a magic `paddingLeft: 44` derived by hand from
// the grid template. `tableLayout: 'fixed'` + percentage widths do the sizing
// now, and the error gets its own row.
//
// The wrapper is `overflow: visible` ON PURPOSE — the item picker's dropdown is
// absolutely positioned and any `overflow: auto/hidden` here would clip it.

import type { DispatchableLine } from '@innovic/shared';
import { X } from 'lucide-react';
import { SearchableSelect } from '@/components/shared/searchable-select';

export interface LineCard {
  id: number;
  soLineId: string | null;
  qty: string;
}

const COL_COUNT = 9;

export function DispatchLineTable(props: {
  cards: LineCard[];
  lines: DispatchableLine[];
  lineErrors: Map<number, string>;
  onPatch: (id: number, patch: Partial<LineCard>) => void;
  onRemove: (id: number) => void;
}): React.JSX.Element {
  const { cards, lines, lineErrors } = props;

  const resolveLine = (soLineId: string | null): DispatchableLine | null =>
    soLineId ? (lines.find((l) => l.salesOrderLineId === soLineId) ?? null) : null;

  // Footer totals — count of picked lines and the pieces actually being sent.
  let pickedCount = 0;
  let totalQty = 0;
  for (const c of cards) {
    const line = resolveLine(c.soLineId);
    if (!line) continue;
    pickedCount += 1;
    const raw = c.qty.trim() === '' ? 0 : Number(c.qty);
    if (!Number.isNaN(raw) && raw > 0) totalQty += raw;
  }

  return (
    <>
      <div
        style={{
          overflow: 'visible',
          border: '1px solid var(--border)',
          borderRadius: 8,
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
          borderBottom: 'none',
        }}
      >
        <table className="innovic-table" style={{ width: '100%', tableLayout: 'fixed', minWidth: 880 }}>
          <thead>
            <tr>
              <th style={{ width: '5%' }}>#</th>
              <th style={{ width: '22%' }}>
                Item Code<span className="req">★</span>
              </th>
              <th style={{ width: '20%' }}>Item Name</th>
              <th style={{ width: '8%' }} className="td-ctr">Order</th>
              <th style={{ width: '8%', color: 'var(--green)' }} className="td-ctr">Ready</th>
              <th style={{ width: '10%' }} className="td-ctr">Dispatched</th>
              <th style={{ width: '9%', color: 'var(--amber)' }} className="td-ctr">Available</th>
              <th style={{ width: '12%', color: 'var(--green)' }} className="td-ctr">
                Dispatch Qty<span className="req">★</span>
              </th>
              <th style={{ width: '6%' }} />
            </tr>
          </thead>
          <tbody>
            {cards.length === 0 ? (
              <tr>
                <td colSpan={COL_COUNT} className="empty-state" style={{ padding: 14 }}>
                  No lines yet — click &ldquo;+ Add Line&rdquo;
                </td>
              </tr>
            ) : (
              cards.map((card, idx) => {
                const line = resolveLine(card.soLineId);
                // Options = this SO's dispatchable lines, minus ones already
                // picked on other rows (can't dispatch the same line twice).
                const usedElsewhere = new Set(
                  cards.filter((c) => c.id !== card.id && c.soLineId).map((c) => c.soLineId),
                );
                const opts = lines
                  .filter((l) => !usedElsewhere.has(l.salesOrderLineId))
                  .map((l) => ({ id: l.salesOrderLineId, code: l.itemCode, name: l.itemName }));
                const err = lineErrors.get(card.id);
                return (
                  <tr key={card.id}>
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--cyan)' }}>{idx + 1}</td>
                    <td>
                      <SearchableSelect
                        // One id per row. The component falls back to a unique
                        // generated id, but a stable, meaningful one keeps the
                        // label/listbox wiring readable and gives tests a handle.
                        id={`dispatch-line-${card.id}`}
                        value={card.soLineId}
                        onChange={(id) => props.onPatch(card.id, { soLineId: id })}
                        onSearch={() => {}}
                        options={opts}
                        placeholder="🔍 code or name…"
                        emptyText="No ready items"
                        // Item Code field shows the code only; the adjacent Item
                        // Name field carries the name. The open dropdown still
                        // renders "CODE — Name" so you can search by either.
                        selectedLabel={(o) => o.code ?? o.name}
                        valueLabel={line ? (line.itemCode ?? line.itemName) : undefined}
                      />
                    </td>
                    <td>
                      <input
                        className="innovic-input"
                        readOnly
                        placeholder="auto-filled"
                        value={line?.itemName ?? ''}
                      />
                    </td>
                    <td className="td-ctr mono">{line ? line.orderQty : '—'}</td>
                    <td className="td-ctr mono" style={{ color: 'var(--green)' }}>
                      {line ? line.readyQty : '—'}
                    </td>
                    <td className="td-ctr mono text3">{line ? line.dispatchedQty : '—'}</td>
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--amber)' }}>
                      {line ? line.availableQty : '—'}
                    </td>
                    <td>
                      <input
                        type="number"
                        className="innovic-input"
                        min={0}
                        max={line?.availableQty ?? undefined}
                        value={card.qty}
                        disabled={!line || line.availableQty <= 0}
                        onChange={(e) => props.onPatch(card.id, { qty: e.target.value })}
                        style={{
                          textAlign: 'center',
                          fontSize: 12,
                          fontWeight: 700,
                          color: err ? 'var(--red)' : 'var(--green)',
                          padding: '4px 4px',
                          ...(err ? { borderColor: 'var(--red)' } : {}),
                        }}
                      />
                      {/* The message sits under its own input rather than in a
                          separate row, so it can never drift out of alignment. */}
                      {err ? (
                        <div className="form-error" style={{ whiteSpace: 'normal', lineHeight: 1.3 }}>
                          ⚠ {err}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-sm"
                        style={{ background: 'transparent', color: 'var(--red)', border: '1px solid var(--red)', padding: '3px 8px' }}
                        title="Remove line"
                        aria-label={`Remove line ${idx + 1}`}
                        onClick={() => props.onRemove(card.id)}
                      >
                        <X size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Totals strip closes the table box — SO Master's pattern. */}
      <div
        style={{
          border: '1px solid var(--border)',
          borderTop: '1px solid var(--border2)',
          borderRadius: '0 0 8px 8px',
          background: 'var(--green3)',
          padding: '8px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        <span className="text3" style={{ fontSize: 11 }}>
          {pickedCount} item{pickedCount === 1 ? '' : 's'} picked
        </span>
        <span style={{ fontSize: 12 }}>
          <span className="green" style={{ fontWeight: 800 }}>TOTAL DISPATCH QTY </span>
          <span className="mono fw-700 green" style={{ fontSize: 16 }}>{totalQty}</span>
        </span>
      </div>
    </>
  );
}
