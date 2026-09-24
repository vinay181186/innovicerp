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
import { itemCodeWithRev } from '@/lib/item-code';
import { fmtDate } from '@/lib/print/doc-print';

export interface LineCard {
  id: number;
  soLineId: string | null;
  qty: string;
}

const COL_COUNT = 14;

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
        <table
          className="innovic-table"
          style={{ width: '100%', tableLayout: 'fixed', minWidth: 1180 }}
        >
          <thead>
            <tr>
              <th style={{ width: '3%' }}>Ln</th>
              {/* POL — the line number on the CUSTOMER's purchase order. Its
                  4% comes out of Item Name, which wraps; the code must not. */}
              <th style={{ width: '4%', color: 'var(--purple)' }} className="td-ctr">
                POL
              </th>
              <th style={{ width: '14%' }}>
                Item Code<span className="req">★</span>
              </th>
              <th style={{ width: '8%' }}>Item Name</th>
              <th style={{ width: '5%' }} className="td-ctr">
                Order Qty
              </th>
              <th style={{ width: '6%', color: 'var(--green)' }} className="td-ctr">
                Ready
              </th>
              <th style={{ width: '8%' }} className="td-ctr">
                Already Dispatched
              </th>
              {/* ADR-180 — Pending is what the customer is still owed; it caps
                  the DC qty. Reserved / Available are the stock position. */}
              <th style={{ width: '6%', color: 'var(--amber)' }} className="td-ctr">
                Pending
              </th>
              {/* The column that used to be called "Available" — ready +
                  reserved to this line, less what has shipped. Renamed so
                  "Available" can mean exactly one thing (free stock). */}
              <th
                style={{ width: '7%' }}
                className="td-ctr"
                title="Ready + reserved to this line, less what has already been dispatched"
              >
                Dispatchable
              </th>
              <th
                style={{ width: '8%', color: 'var(--purple)' }}
                className="td-ctr"
                title="Stock already booked to THIS SO line — dispatched first"
              >
                Reserved (this line)
              </th>
              <th
                style={{ width: '8%', color: 'var(--cyan)' }}
                className="td-ctr"
                title="Free stock of this item: Physical − Reserved to any line"
              >
                Available (free stock)
              </th>
              {/* Earliest Customer Dispatch Date among the plans on the SO
                  line — the date the dispatch team works to. */}
              <th style={{ width: '9%' }} className="td-ctr">
                Customer Dispatch Date
              </th>
              <th style={{ width: '10%', color: 'var(--green)' }} className="td-ctr">
                Dispatch Qty<span className="req">★</span>
              </th>
              <th style={{ width: '4%' }} />
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
                  // The dropdown labels each option with the drawing revision —
                  // "IN-IT-0007/B" — because two SO lines for the same part at
                  // different revisions are otherwise indistinguishable here.
                  // What the picker SUBMITS is still the SO line id, so this is
                  // a label only; a line with no revision keeps the bare code.
                  .map((l) => ({
                    id: l.salesOrderLineId,
                    code: itemCodeWithRev(l.itemCode, l.itemRevision, '') || null,
                    name: l.itemName,
                  }));
                const err = lineErrors.get(card.id);
                return (
                  <tr key={card.id}>
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--cyan)' }}>
                      {idx + 1}
                    </td>
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--purple)' }}>
                      {line?.clientPoLineNo ?? '—'}
                    </td>
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
                        valueLabel={
                          line
                            ? itemCodeWithRev(line.itemCode, line.itemRevision, line.itemName)
                            : undefined
                        }
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
                      {line ? (
                        <>
                          {line.readyQty}
                          {line.reservedQty > 0 ? (
                            <div style={{ fontSize: 10, color: 'var(--purple)' }}>
                              +{line.reservedQty} resv
                            </div>
                          ) : null}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="td-ctr mono text3">{line ? line.dispatchedQty : '—'}</td>
                    {/* ADR-180 — Pending caps the dispatch qty. */}
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--amber)' }}>
                      {line ? line.pendingQty : '—'}
                    </td>
                    <td className="td-ctr mono">{line ? line.availableQty : '—'}</td>
                    <td
                      className="td-ctr mono fw-700"
                      style={{ color: 'var(--purple)' }}
                      title={line ? `${line.reservedQty} pcs booked to this SO line` : undefined}
                    >
                      {line ? line.reservedQty : '—'}
                    </td>
                    <td
                      className="td-ctr mono"
                      style={{ color: 'var(--cyan)' }}
                      title={
                        line
                          ? `Physical ${line.physicalQty} − reserved to any line = ${line.itemAvailableQty} free`
                          : undefined
                      }
                    >
                      {line ? line.itemAvailableQty : '—'}
                    </td>
                    <td className="td-ctr mono" style={{ whiteSpace: 'nowrap' }}>
                      {line?.customerDispatchDate ? fmtDate(line.customerDispatchDate) : '—'}
                    </td>
                    <td>
                      <input
                        type="number"
                        className="innovic-input"
                        min={0}
                        max={line ? Math.min(line.availableQty, line.pendingQty) : undefined}
                        value={card.qty}
                        disabled={!line || Math.min(line.availableQty, line.pendingQty) <= 0}
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
                        <div
                          className="form-error"
                          style={{ whiteSpace: 'normal', lineHeight: 1.3 }}
                        >
                          ⚠ {err}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-sm"
                        style={{
                          background: 'transparent',
                          color: 'var(--red)',
                          border: '1px solid var(--red)',
                          padding: '3px 8px',
                        }}
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
          <span className="green" style={{ fontWeight: 800 }}>
            TOTAL DISPATCH QTY{' '}
          </span>
          <span className="mono fw-700 green" style={{ fontSize: 16 }}>
            {totalQty}
          </span>
        </span>
      </div>

      {/* ADR-180 — where the pieces come from, in one quiet line. */}
      <div className="text3" style={{ fontSize: 11, marginTop: 6 }}>
        💡 A dispatch uses the stock reserved to that line first, then free stock. Dispatch qty is
        capped at Pending — what the customer is still owed on the line.
      </div>
    </>
  );
}
