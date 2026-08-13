// The "Receipts" panel of the OSP Outward DC detail page — one block per
// inward receipt booked against the challan, each with its own item table.
//
// Split out of routes/detail.tsx (2026-08-13) when the styling pass pushed that
// file past the 400-line rule. Presentation only; the caller still owns the
// data and the DC-line lookup the receipt rows resolve their item against.

import type { DeliveryChallanLine, DeliveryChallanWithLines } from '@innovic/shared';

export function DcReceiptsPanel({
  receipts,
  lineLookup,
}: {
  receipts: DeliveryChallanWithLines['receipts'];
  /** DC line id → line, so a receipt row can name the item it received. */
  lineLookup: Map<string, DeliveryChallanLine>;
}): React.JSX.Element | null {
  if (receipts.length === 0) return null;

  return (
    <div className="panel">
      <div className="panel-hdr">
        <div className="panel-title">Receipts</div>
        <span className="text3" style={{ fontSize: 11 }}>
          {receipts.length} receipt{receipts.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="panel-body" style={{ padding: 0 }}>
        {receipts.map((rcpt) => (
          <div
            key={rcpt.id}
            // `var(--line)` is not a token in tokens.css, so this separator was
            // an invalid declaration the browser dropped — the receipts ran
            // together with no rule between them.
            style={{ padding: '10px 14px', borderTop: '1px solid var(--border)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontSize: 12 }}>
                <span className="mono">{rcpt.receiptCode}</span>{' '}
                <span className="text3">· {rcpt.receiptDate}</span>
                {rcpt.vendorInvoiceText ? (
                  <span className="text3">
                    {' '}
                    · inv <span className="mono">{rcpt.vendorInvoiceText}</span>
                  </span>
                ) : null}
              </div>
              <div className="text3" style={{ fontSize: 11 }}>
                {rcpt.lines.length} line{rcpt.lines.length === 1 ? '' : 's'}
              </div>
            </div>
            {rcpt.remarks ? (
              <div className="text3" style={{ fontSize: 11, marginBottom: 6 }}>
                {rcpt.remarks}
              </div>
            ) : null}
            {/* `.tbl-wrap` so this nested table scrolls inside its own box
                instead of widening the page (styling skill Rule 1). */}
            <div className="tbl-wrap">
              <table className="innovic-table" style={{ fontSize: 11 }}>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="td-right">Received</th>
                    <th className="td-right">Rejected</th>
                    <th>Reject reason</th>
                  </tr>
                </thead>
                <tbody>
                  {rcpt.lines.map((rl) => {
                    const ll = lineLookup.get(rl.deliveryChallanLineId);
                    return (
                      <tr key={rl.id}>
                        <td>
                          {/* Live master code/name first, issue-time snapshot as
                              the fallback — the Lines table already did this, so
                              a renamed item read two ways on one page. */}
                          <span className="mono">{ll?.itemCode ?? ll?.itemCodeText ?? '—'}</span>
                          {ll?.itemName ?? ll?.itemNameText ? (
                            <span className="text3" style={{ marginLeft: 6 }}>
                              {ll?.itemName ?? ll?.itemNameText}
                            </span>
                          ) : null}
                        </td>
                        <td className="td-right mono" style={{ color: 'var(--green2)' }}>
                          {Number(rl.receivedQty).toFixed(2)}
                        </td>
                        <td className="td-right mono" style={{ color: 'var(--red2)' }}>
                          {Number(rl.rejectedQty).toFixed(2)}
                        </td>
                        <td className="text3">{rl.rejectReason ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
