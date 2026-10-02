// ▸ detail row of the Customer Dispatch FIT table (ADR-199): the dispatched
// item lines + the dispatch Remarks. Was the Band-3 line table inside the old
// DispatchCard. Alignment follows the 2026-09-26 table standard — text columns
// centred, number columns (Dispatch Qty, Stock) right-aligned (th-num/td-num).

import { itemCodeWithRev } from '@/lib/item-code';
import type { DispatchGroup } from './dispatch-group';

export function DispatchExpanded({ g }: { g: DispatchGroup }): React.JSX.Element {
  return (
    <div style={{ padding: '8px 12px' }}>
      <div
        style={{
          fontSize: 11,
          color: 'var(--blue)',
          fontFamily: 'var(--mono)',
          fontWeight: 700,
          marginBottom: 6,
        }}
      >
        Items
      </div>
      {/* tbl-ctr — table-alignment standard: text centred, numbers right-aligned.
          No .tbl-wrap inside the detail row; the engine owns the width. */}
      <table className="innovic-table tbl-ctr" style={{ width: '100%', margin: 0 }}>
        <thead>
          <tr style={{ background: 'var(--bg4)' }}>
            <th>JC No.</th>
            <th style={{ color: 'var(--purple)' }}>POL</th>
            <th>Item Code</th>
            <th>Item Name</th>
            <th className="th-num" style={{ color: 'var(--green2)' }}>
              Dispatch Qty
            </th>
            <th>UOM</th>
            <th className="th-num">Stock Before → After</th>
          </tr>
        </thead>
        <tbody>
          {g.lines.map((l, i) => (
            <tr key={`${l.dispatchId}-${i}`} style={{ background: 'var(--bg)' }}>
              <td className="td-code" style={{ color: 'var(--cyan)', fontSize: 11 }}>
                {l.jcNo ?? <span style={{ color: 'var(--text3)' }}>—</span>}
              </td>
              <td
                className="mono"
                style={{ fontSize: 11, color: 'var(--purple)', fontWeight: 700 }}
              >
                {l.clientPoLineNo ?? '—'}
              </td>
              {/* Code carries the customer's drawing revision ("IN-IT-0007/B"),
                  read off the SO line this piece shipped against. */}
              <td className="td-code mono fw-700" style={{ color: 'var(--text)' }}>
                {itemCodeWithRev(l.itemCode ?? l.itemCodeText, l.itemRevision)}
              </td>
              <td className="fw-700">{l.itemName}</td>
              <td className="mono fw-700 td-num" style={{ color: 'var(--green2)' }}>
                {l.qty}
              </td>
              <td>
                <span className="badge b-grey">{l.uom ?? 'NOS'}</span>
              </td>
              <td className="mono td-num" style={{ fontSize: 11, color: 'var(--text3)' }}>
                {l.stockBefore ?? '—'}→{l.stockAfter ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Remarks — the dispatch-grain note the old card's meta line carried. */}
      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text2)' }}>
        <span style={{ color: 'var(--text3)' }}>Remarks: </span>
        {g.remarks?.trim() || '—'}
      </div>
    </div>
  );
}
