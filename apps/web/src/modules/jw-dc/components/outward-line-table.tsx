// The "PO Lines" picker inside New Outward DC (split out of routes/list.tsx so
// the modal stays under the 400-line ceiling). A form-style editor table: tick
// a line, type Send Now. Numbers right-align (owner decision 2026-09-26); the
// tick and POL are centred.

import { itemCodeWithRev } from '@/lib/item-code';

export interface OutwardLineUi {
  purchaseOrderLineId: string;
  itemCode: string;
  /** Customer's drawing revision off the order line behind this PO line. */
  itemRevision: string | null;
  /** The CUSTOMER's own purchase-order line number (POL), read-only. */
  clientPoLineNo: string | null;
  itemName: string;
  processText: string | null;
  uom: string | null;
  poQty: number;
  alreadySent: number;
  available: number;
  sendQty: number;
  checked: boolean;
}

export function OutwardLineTable({
  lines,
  setLine,
}: {
  lines: OutwardLineUi[];
  setLine: (i: number, patch: Partial<OutwardLineUi>) => void;
}): React.JSX.Element {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', background: 'var(--bg4)', fontWeight: 700, fontSize: 12 }}>
        PO Lines
      </div>
      <table style={{ width: '100%' }}>
        <thead>
          <tr style={{ background: 'var(--bg4)' }}>
            <th style={{ width: 30, padding: 6 }}>☑</th>
            {/* POL — the CUSTOMER's own purchase-order line number, before the
                item as on every other document. */}
            <th style={{ padding: 6, color: 'var(--purple)' }}>POL</th>
            <th style={{ padding: 6 }}>Item Code · Name</th>
            <th style={{ color: 'var(--purple)', padding: 6 }}>Process</th>
            <th className="th-num" style={{ padding: 6 }}>
              PO Qty
            </th>
            <th style={{ padding: 6 }}>UOM</th>
            {/* Sent on OSP DCs AND JW DCs together — the one figure. */}
            <th className="th-num" style={{ color: 'var(--amber2)', padding: 6 }}>
              Sent
            </th>
            <th className="th-num" style={{ color: 'var(--green2)', padding: 6 }}>
              Pending
            </th>
            <th className="th-num" style={{ color: 'var(--cyan)', padding: 6 }}>
              Send Now<span className="req">★</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const hasQty = l.available > 0;
            return (
              <tr
                key={l.purchaseOrderLineId}
                style={{
                  background: i % 2 === 0 ? 'var(--bg)' : 'var(--bg3)',
                  opacity: hasQty ? 1 : 0.4,
                }}
              >
                <td className="td-ctr" style={{ padding: 6 }}>
                  <input
                    type="checkbox"
                    checked={hasQty && l.checked}
                    disabled={!hasQty}
                    onChange={(e) => setLine(i, { checked: e.target.checked })}
                    style={{ width: 16, height: 16 }}
                  />
                </td>
                <td className="td-ctr mono fw-700" style={{ padding: 6, color: 'var(--purple)' }}>
                  {l.clientPoLineNo ?? '—'}
                </td>
                <td style={{ padding: 6, fontSize: 12 }}>
                  <b>{itemCodeWithRev(l.itemCode, l.itemRevision)}</b>{' '}
                  <span style={{ color: 'var(--text3)' }}>{l.itemName}</span>
                </td>
                <td style={{ padding: 6, fontSize: 11, color: 'var(--purple)' }}>
                  {l.processText ?? '—'}
                </td>
                <td className="mono td-num" style={{ padding: 6 }}>
                  {l.poQty}
                </td>
                <td className="mono" style={{ padding: 6, fontSize: 11 }}>
                  {l.uom ?? 'NOS'}
                </td>
                <td className="mono td-num" style={{ padding: 6, color: 'var(--amber2)' }}>
                  {l.alreadySent > 0 ? l.alreadySent : '0'}
                </td>
                <td
                  className="mono fw-700 td-num"
                  style={{ padding: 6, color: l.available > 0 ? 'var(--green)' : 'var(--red)' }}
                >
                  {l.available}
                </td>
                <td className="td-num" style={{ padding: 6 }}>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    max={l.available}
                    value={l.sendQty}
                    disabled={!hasQty}
                    onChange={(e) =>
                      setLine(i, { sendQty: Math.min(Number(e.target.value) || 0, l.available) })
                    }
                    style={{
                      width: 70,
                      fontSize: 14,
                      fontWeight: 700,
                      textAlign: 'right',
                      color: 'var(--cyan)',
                      border: '2px solid var(--cyan)',
                      borderRadius: 4,
                    }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
