// Edit-dispatch line editor (ADR-202) — the read-only sibling of
// DispatchLineTable. On an EXISTING dispatch the set of items and the SO cannot
// change, so there is no item picker and no add/remove: each row shows its saved
// item (code · name · POL) and lets the user change only the Dispatch Qty.
//
// The qty cap when editing is the line's CURRENT qty plus whatever is still
// dispatchable on its SO line (the dispatchable endpoint already subtracts this
// dispatch's qty, so adding it back gives "how high this line may go"). The
// server is the final arbiter; this is the live, friendly guard that mirrors the
// create form's cap display.

import type { CustomerDispatchLineRow, DispatchableLine } from '@innovic/shared';
import { MasterItemNameNote } from '@/components/shared/master-item-name-note';
import { itemCodeWithRev } from '@/lib/item-code';

export interface EditLineCard {
  /** customer_dispatch_lines.id — the key the staged-edit diff uses. */
  id: string;
  qty: string;
}

const COL_COUNT = 8;

/** The most this line's qty may be set to while editing: its current qty plus
 *  the SO line's still-dispatchable qty. When the SO line is no longer in the
 *  dispatchable set (fully shipped), only the current qty can be kept or lowered. */
export function editLineCap(current: number, dl: DispatchableLine | null): number {
  if (!dl) return current;
  return current + Math.min(dl.availableQty, dl.pendingQty);
}

export function DispatchEditLineTable(props: {
  cards: EditLineCard[];
  /** The dispatch's saved lines (item code/name/POL + current qty). */
  savedLines: CustomerDispatchLineRow[];
  /** The SO's dispatchable lines (order/pending/available), by SO line id. */
  dispatchable: DispatchableLine[];
  lineErrors: Map<string, string>;
  onPatch: (id: string, qty: string) => void;
}): React.JSX.Element {
  const { cards, savedLines, dispatchable, lineErrors } = props;

  const savedById = new Map(savedLines.map((l) => [l.id, l]));
  const dlBySoLine = new Map(dispatchable.map((l) => [l.salesOrderLineId, l]));

  let totalQty = 0;
  for (const c of cards) {
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
          style={{ width: '100%', tableLayout: 'fixed', minWidth: 760 }}
        >
          <thead>
            <tr>
              <th style={{ width: '4%' }}>Ln</th>
              <th style={{ width: '5%', color: 'var(--purple)' }} className="td-ctr">
                POL
              </th>
              <th style={{ width: '22%' }}>Item Code</th>
              <th style={{ width: '27%' }}>Item Name</th>
              <th style={{ width: '9%' }} className="th-num">
                Order Qty
              </th>
              <th style={{ width: '9%', color: 'var(--amber2)' }} className="th-num">
                Pending
              </th>
              <th style={{ width: '12%' }} className="th-num">
                Dispatchable
              </th>
              <th style={{ width: '12%', color: 'var(--green2)' }} className="th-num">
                Dispatch Qty<span className="req">★</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {cards.length === 0 ? (
              <tr>
                <td colSpan={COL_COUNT} className="empty-state" style={{ padding: 14 }}>
                  No lines on this dispatch.
                </td>
              </tr>
            ) : (
              cards.map((card, idx) => {
                const saved = savedById.get(card.id);
                const dl = saved?.salesOrderLineId
                  ? (dlBySoLine.get(saved.salesOrderLineId) ?? null)
                  : null;
                const current = saved ? saved.qty : 0;
                const cap = editLineCap(current, dl);
                const err = lineErrors.get(card.id);
                return (
                  <tr key={card.id}>
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--cyan)' }}>
                      {idx + 1}
                    </td>
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--purple)' }}>
                      {saved?.clientPoLineNo ?? '—'}
                    </td>
                    <td>
                      <input
                        className="innovic-input"
                        readOnly
                        value={
                          saved
                            ? itemCodeWithRev(saved.itemCode, saved.itemRevision, '') ||
                              (saved.itemCodeText ?? '')
                            : ''
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="innovic-input"
                        readOnly
                        value={saved?.itemName ?? ''}
                      />
                      <MasterItemNameNote
                        lineName={saved?.itemName}
                        masterItemName={saved?.masterItemName}
                      />
                    </td>
                    <td className="mono td-num">{dl ? dl.orderQty : '—'}</td>
                    <td className="mono fw-700 td-num" style={{ color: 'var(--amber2)' }}>
                      {dl ? dl.pendingQty : '—'}
                    </td>
                    <td
                      className="mono td-num"
                      style={{ cursor: dl ? 'help' : undefined }}
                      title={
                        dl
                          ? `You may set this line up to ${cap} (current ${current} + still dispatchable ${Math.min(dl.availableQty, dl.pendingQty)}).`
                          : `Fully shipped on its SO line — keep or lower the current ${current}.`
                      }
                    >
                      {cap}
                    </td>
                    <td className="td-num">
                      <input
                        type="number"
                        className="innovic-input"
                        min={0}
                        max={cap}
                        value={card.qty}
                        onChange={(e) => props.onPatch(card.id, e.target.value)}
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: err ? 'var(--red)' : 'var(--green)',
                          padding: '4px 4px',
                          ...(err ? { borderColor: 'var(--red)' } : {}),
                        }}
                      />
                      {err ? (
                        <div className="form-error" style={{ whiteSpace: 'normal', lineHeight: 1.3 }}>
                          ⚠ {err}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Totals strip closes the table box — the create form's pattern. */}
      <div
        style={{
          border: '1px solid var(--border)',
          borderTop: '1px solid var(--border2)',
          borderRadius: '0 0 8px 8px',
          background: 'var(--green3)',
          padding: '8px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
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
