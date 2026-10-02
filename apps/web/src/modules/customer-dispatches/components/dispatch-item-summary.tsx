// Item-wise Summary panel on the Customer Dispatch register (legacy
// renderDispatchRegister item roll-up). Folded away by default so the Dispatch
// Log is first. One row per ITEM over the ACTIVE register rows (cancelled
// dispatches were reversed), with the item's current on-hand stock beside it.
// Worked out on the SERVER over every matching row (ADR-201), not the page.
//
// The drawing revision is deliberately left out of both the key and the code
// shown — Rev A and Rev B of a part are one item holding one stock figure, and
// splitting them here would double the rows. The ▸ line tables carry the rev.

import type { CustomerDispatchItemSummary } from '@innovic/shared';
import { useState } from 'react';

export function DispatchItemSummary({
  items,
}: {
  items: CustomerDispatchItemSummary[];
}): React.JSX.Element | null {
  const [showSummary, setShowSummary] = useState(false);
  const summary = items.map((it) => ({
    code: it.itemCode,
    name: it.itemName,
    total: it.totalQty,
    count: it.lineCount,
    stock: it.currentStock,
  }));

  if (summary.length === 0) return null;

  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-expanded={showSummary}
          onClick={() => setShowSummary((v) => !v)}
        >
          {showSummary ? '▾ Hide summary' : '▸ Show summary'}
        </button>
      </div>
      {showSummary ? (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-hdr">
            <span className="panel-title">Item-wise Summary</span>
          </div>
          <div className="tbl-wrap">
            <table className="innovic-table tbl-grid tbl-auto">
              <thead>
                <tr>
                  <th>Item Code</th>
                  <th>Item Name</th>
                  <th className="th-num">Total Dispatched</th>
                  <th className="th-num">No. of Dispatches</th>
                  <th className="th-num" style={{ color: 'var(--green2)' }}>
                    Current Stock
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.map((s) => (
                  <tr key={s.code + s.name}>
                    <td className="td-code" style={{ color: 'var(--purple)' }}>
                      {s.code}
                    </td>
                    <td className="fw-700">{s.name}</td>
                    <td className="mono fw-700 td-num" style={{ color: 'var(--green2)' }}>
                      {s.total}
                    </td>
                    <td className="mono td-num" style={{ fontSize: 11, color: 'var(--text3)' }}>
                      {s.count}
                    </td>
                    <td className="mono fw-700 td-num" style={{ color: 'var(--green2)' }}>
                      {s.stock ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </>
  );
}
