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
import { MasterItemNameNote } from '@/components/shared/master-item-name-note';
import { SearchableSelect } from '@/ui/forms';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { parseRowOptionKey, rowBucket, rowCap, rowOptionKey } from './dispatch-rev-buckets';

export interface LineCard {
  id: number;
  soLineId: string | null;
  /** Phase C — the Item + Rev bucket this row ships from (null = the no-Rev
   *  bucket). `undefined` = the line has no buckets: one row per line. */
  itemRevisionId?: string | null | undefined;
  qty: string;
}

const COL_COUNT = 10;

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
          style={{ width: '100%', tableLayout: 'fixed', minWidth: 900 }}
        >
          <thead>
            <tr>
              <th style={{ width: '3%' }}>Ln</th>
              {/* POL — the line number on the CUSTOMER's purchase order. Its
                  4% comes out of Item Name, which wraps; the code must not. */}
              <th style={{ width: '4%', color: 'var(--purple)' }} className="td-ctr">
                POL
              </th>
              <th style={{ width: '18%' }}>
                Item Code<span className="req">★</span>
              </th>
              <th style={{ width: '24%' }}>Item Name</th>
              <th style={{ width: '7%' }} className="th-num">
                Order Qty
              </th>
              {/* ADR-180 — Pending is what the customer is still owed; it caps
                  the DC qty. */}
              <th style={{ width: '7%', color: 'var(--amber2)' }} className="th-num">
                Pending
              </th>
              {/* Ready + reserved to this line, less what has shipped. The
                  stock breakdown (Ready · Dispatched · Reserved · Available)
                  sits in the cell's tooltip rather than four more columns. */}
              <th
                style={{ width: '9%' }}
                className="th-num"
                title="Ready + reserved to this line, less what has already been dispatched."
              >
                Dispatchable
              </th>
              {/* Earliest Customer Dispatch Date among the plans on the SO
                  line — the date the dispatch team works to. */}
              <th style={{ width: '9%' }} className="td-ctr">
                Customer Dispatch Date
              </th>
              <th style={{ width: '10%', color: 'var(--green2)' }} className="th-num">
                Dispatch Qty<span className="req">★</span>
              </th>
              <th style={{ width: '4%' }} />
            </tr>
          </thead>
          <tbody>
            {cards.length === 0 ? (
              <tr>
                <td colSpan={COL_COUNT} className="empty-state" style={{ padding: 14 }}>
                  No lines yet.
                </td>
              </tr>
            ) : (
              cards.map((card, idx) => {
                const line = resolveLine(card.soLineId);
                const bucket = rowBucket(line, card.itemRevisionId);
                const cap = line ? rowCap(line, bucket) : 0;
                // Options = this SO's dispatchable lines — one per Drawing Rev
                // bucket when the line holds pieces of more than one Rev
                // (ABC/1 and ABC/2) — minus ones already picked on other rows.
                const usedElsewhere = new Set(
                  cards
                    .filter((c) => c.id !== card.id && c.soLineId)
                    .map((c) => rowOptionKey(c.soLineId as string, c.itemRevisionId)),
                );
                const opts = lines
                  .flatMap((l) =>
                    l.revBuckets.length > 0
                      ? l.revBuckets.map((b) => ({
                          id: rowOptionKey(l.salesOrderLineId, b.itemRevisionId ?? null),
                          code: b.label,
                          name: `${l.itemName} · Ready ${b.readyQty}`,
                        }))
                      : // The dropdown labels each option with the drawing
                        // revision — "IN-IT-0007/B" — because two SO lines for
                        // the same part at different revisions are otherwise
                        // indistinguishable here. A label only.
                        [
                          {
                            id: l.salesOrderLineId,
                            code: itemCodeWithRev(l.itemCode, l.itemRevision, '') || null,
                            name: l.itemName,
                          },
                        ],
                  )
                  .filter((o) => !usedElsewhere.has(o.id));
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
                        value={
                          card.soLineId ? rowOptionKey(card.soLineId, card.itemRevisionId) : null
                        }
                        onChange={(key) => {
                          if (!key) {
                            props.onPatch(card.id, { soLineId: null, itemRevisionId: undefined });
                            return;
                          }
                          const { soLineId, itemRevisionId } = parseRowOptionKey(key);
                          props.onPatch(card.id, { soLineId, itemRevisionId });
                        }}
                        onSearch={() => {}}
                        options={opts}
                        placeholder="🔍 code or name…"
                        emptyText="No ready items"
                        // Item Code field shows the code only; the adjacent Item
                        // Name field carries the name. The open dropdown still
                        // renders "CODE — Name" so you can search by either.
                        selectedLabel={(o) => o.code ?? o.name}
                        valueLabel={
                          bucket
                            ? bucket.label
                            : line
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
                      <MasterItemNameNote
                        lineName={line?.itemName}
                        masterItemName={line?.masterItemName}
                      />
                    </td>
                    <td className="mono td-num">{line ? line.orderQty : '—'}</td>
                    {/* ADR-180 — Pending caps the dispatch qty. */}
                    <td className="mono fw-700 td-num" style={{ color: 'var(--amber2)' }}>
                      {line ? line.pendingQty : '—'}
                    </td>
                    <td
                      className="mono td-num"
                      style={{ cursor: line ? 'help' : undefined }}
                      title={
                        line
                          ? `${bucket ? `${bucket.label}: Ready ${bucket.readyQty} · ` : ''}Ready ${line.readyQty} · Dispatched ${line.dispatchedQty} · Reserved (this line) ${line.reservedQty} · Available ${line.itemAvailableQty} (Physical ${line.physicalQty} − Reserved)`
                          : undefined
                      }
                    >
                      {line ? (bucket ? cap : line.availableQty) : '—'}
                    </td>
                    <td className="td-ctr mono" style={{ whiteSpace: 'nowrap' }}>
                      {fmtDate(line?.customerDispatchDate)}
                    </td>
                    <td className="td-num">
                      <input
                        type="number"
                        className="innovic-input"
                        min={0}
                        max={line ? cap : undefined}
                        value={card.qty}
                        disabled={!line || cap <= 0}
                        onChange={(e) => props.onPatch(card.id, { qty: e.target.value })}
                        style={{
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
                          color: 'var(--red2)',
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
            Total Dispatch Qty{' '}
          </span>
          <span className="mono fw-700 green" style={{ fontSize: 16 }}>
            {totalQty}
          </span>
        </span>
      </div>
    </>
  );
}
