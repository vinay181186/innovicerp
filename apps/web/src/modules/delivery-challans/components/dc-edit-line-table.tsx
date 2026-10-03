// Edit-DC line editor (ADR-202 Phase 3) — the read-only-items sibling of the
// create form's "Items to Send" table. On a SAVED delivery challan the PO, the
// vendor and the set of items are fixed, so there is no item picker and no
// add/remove: each row shows its saved item (POL · code/rev · name · UOM) and
// lets the user change only the challan Qty, the per-line Material and the DC
// Remarks.
//
// The qty cap when editing is the line's CURRENT qty plus whatever is still
// sendable on its PO line — the same `useDcSendable` figure the create form
// shows as "Can send now". That preview already counts this DC's own qty as
// sent (the DC is live), so adding the current qty back gives "how high this
// line may go". The server is the final arbiter; this is the live, friendly
// guard that mirrors the create form's cap display.

import type { DcSendableLine, DeliveryChallanLine } from '@innovic/shared';
import { qtyStepForUom } from '@innovic/shared';
import { itemCodeWithRev } from '@/lib/item-code';

export interface DcEditLineCard {
  /** delivery_challan_lines.id — the key the staged-edit diff uses. */
  id: string;
  qty: string;
  materialText: string;
  dcRemarks: string;
}

const COL_COUNT = 10;

/** The most this line's qty may be set to while editing: its current qty plus
 *  the PO line's still-sendable qty (`maxSendNow`). When the PO line is not in
 *  the sendable set (an NC challan has no PO, or the line is fully sent), only
 *  the current qty can be kept or lowered. */
export function dcEditLineCap(current: number, sl: DcSendableLine | undefined): number {
  if (!sl) return current;
  return current + sl.maxSendNow;
}

export function DcEditLineTable(props: {
  cards: DcEditLineCard[];
  /** The DC's saved lines (POL · item code/name · UOM + current qty). */
  savedLines: DeliveryChallanLine[];
  /** The PO's sendable lines (maxSendNow), by purchase_order_lines.id. */
  sendable: DcSendableLine[];
  lineErrors: Map<string, string>;
  onPatch: (id: string, patch: Partial<Omit<DcEditLineCard, 'id'>>) => void;
}): React.JSX.Element {
  const { cards, savedLines, sendable, lineErrors } = props;

  const savedById = new Map(savedLines.map((l) => [l.id, l]));
  const slByPoLine = new Map(sendable.map((l) => [l.purchaseOrderLineId, l]));

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
          style={{ width: '100%', tableLayout: 'fixed', minWidth: 820 }}
        >
          <thead>
            <tr>
              <th style={{ width: '4%' }}>Ln</th>
              <th style={{ width: '5%', color: 'var(--purple)' }}>POL</th>
              <th style={{ width: '16%' }}>Item Code</th>
              <th style={{ width: '20%' }}>Item Name</th>
              <th style={{ width: '8%' }} className="th-num">
                Current Qty
              </th>
              <th style={{ width: '6%' }}>UOM</th>
              <th style={{ width: '11%' }} className="th-num">
                Can Send Now
              </th>
              <th style={{ width: '10%', color: 'var(--green2)' }} className="th-num">
                Challan Qty<span className="req">★</span>
              </th>
              <th style={{ width: '10%' }}>Material</th>
              <th style={{ width: '10%' }}>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {cards.length === 0 ? (
              <tr>
                <td colSpan={COL_COUNT} className="empty-state" style={{ padding: 14 }}>
                  No lines on this DC.
                </td>
              </tr>
            ) : (
              cards.map((card, idx) => {
                const saved = savedById.get(card.id);
                const sl = saved?.purchaseOrderLineId
                  ? slByPoLine.get(saved.purchaseOrderLineId)
                  : undefined;
                const current = saved ? Number(saved.qty) : 0;
                const cap = dcEditLineCap(current, sl);
                const extra = sl ? sl.maxSendNow : 0;
                const err = lineErrors.get(card.id);
                return (
                  <tr key={card.id}>
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--blue)' }}>
                      {saved?.lineNo ?? idx + 1}
                    </td>
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--purple)' }}>
                      {saved?.clientPoLineNo ?? '—'}
                    </td>
                    <td
                      className="mono"
                      style={{ color: 'var(--text)', fontWeight: 700, whiteSpace: 'nowrap' }}
                    >
                      {saved
                        ? itemCodeWithRev(saved.itemCode ?? saved.itemCodeText, saved.itemRevision)
                        : '—'}
                    </td>
                    <td>{saved?.itemName ?? saved?.itemNameText ?? '—'}</td>
                    <td className="mono td-num">{current}</td>
                    <td className="mono">{saved?.uom ?? '—'}</td>
                    <td
                      className="mono td-num"
                      style={{ cursor: sl ? 'help' : undefined }}
                      title={
                        sl
                          ? `You may set this line up to ${cap} (current ${current} + still sendable ${extra}).`
                          : `No sendable preview — keep or lower the current ${current}.`
                      }
                    >
                      {cap}
                    </td>
                    <td className="td-num">
                      <input
                        type="number"
                        className="innovic-input"
                        step={saved ? qtyStepForUom(saved.uom) : 1}
                        min={0}
                        max={cap}
                        value={card.qty}
                        onChange={(e) => props.onPatch(card.id, { qty: e.target.value })}
                        style={{
                          width: '100%',
                          fontSize: 12,
                          fontWeight: 700,
                          color: err ? 'var(--red)' : 'var(--green)',
                          padding: '4px 4px',
                          ...(err ? { borderColor: 'var(--red)' } : {}),
                        }}
                      />
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
                      <input
                        className="innovic-input"
                        value={card.materialText}
                        onChange={(e) => props.onPatch(card.id, { materialText: e.target.value })}
                        placeholder="optional"
                        style={{ width: '100%' }}
                      />
                    </td>
                    <td>
                      <textarea
                        rows={1}
                        className="innovic-textarea"
                        value={card.dcRemarks}
                        onChange={(e) => props.onPatch(card.id, { dcRemarks: e.target.value })}
                        placeholder="optional"
                        style={{ width: '100%' }}
                      />
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
            Total Challan Qty{' '}
          </span>
          <span className="mono fw-700 green" style={{ fontSize: 16 }}>
            {totalQty}
          </span>
        </span>
      </div>
    </>
  );
}
