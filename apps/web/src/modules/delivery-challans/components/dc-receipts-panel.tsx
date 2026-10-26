// The "Receipts" panel of the OSP Outward DC detail page — one block per
// inward receipt booked against the challan, each with its own item table.
//
// Split out of routes/detail.tsx (2026-08-13) when the styling pass pushed that
// file past the 400-line rule. Presentation only; the caller still owns the
// data and the DC-line lookup the receipt rows resolve their item against.
//
// ADR-235 — each live receipt offers "Cancel Receipt" (the ONE standard Cancel
// dialog, docType 'dc_receipt', opened by the caller). A Cancelled receipt
// stays in the list, washed grey with its code struck and "Cancelled — reason".

import type { DeliveryChallanLine, DeliveryChallanWithLines } from '@innovic/shared';
import { fmtDate, fmtDateTime } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';

type DcReceipt = DeliveryChallanWithLines['receipts'][number];

export function DcReceiptsPanel({
  receipts,
  lineLookup,
  onCancel,
}: {
  receipts: DeliveryChallanWithLines['receipts'];
  /** DC line id → line, so a receipt row can name the item it received. */
  lineLookup: Map<string, DeliveryChallanLine>;
  /** ADR-235 — opens the Cancel dialog for a receipt; undefined hides the
   *  button (the user holds neither Edit nor Approve on OSP DC). */
  onCancel?: ((receipt: DcReceipt) => void) | undefined;
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
        {receipts.map((rcpt) => {
          const cancelled = Boolean(rcpt.cancelledAt);
          return (
            <div
              key={rcpt.id}
              // `var(--line)` is not a token in tokens.css, so this separator was
              // an invalid declaration the browser dropped — the receipts ran
              // together with no rule between them.
              style={{
                padding: '10px 14px',
                borderTop: '1px solid var(--border)',
                ...(cancelled ? { background: 'var(--bg4)' } : {}),
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ fontSize: 12 }}>
                  <span
                    className="mono"
                    style={cancelled ? { textDecoration: 'line-through' } : undefined}
                  >
                    {rcpt.receiptCode}
                  </span>{' '}
                  <span className="text3">· {fmtDate(rcpt.receiptDate)}</span>
                  {rcpt.vendorInvoiceText ? (
                    <span className="text3">
                      {' '}
                      · inv <span className="mono">{rcpt.vendorInvoiceText}</span>
                    </span>
                  ) : null}
                </div>
                <div
                  className="text3"
                  style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  {cancelled ? (
                    <span
                      className="badge b-red"
                      title={rcpt.cancelledAt ? fmtDateTime(rcpt.cancelledAt) : undefined}
                    >
                      Cancelled — {rcpt.cancelReason ?? '—'}
                    </span>
                  ) : null}
                  {cancelled ? null : (
                    <span>
                      {rcpt.lines.length} line{rcpt.lines.length === 1 ? '' : 's'}
                    </span>
                  )}
                  {onCancel && !cancelled ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ color: 'var(--red2)' }}
                      onClick={() => onCancel(rcpt)}
                    >
                      Cancel Receipt
                    </button>
                  ) : null}
                </div>
              </div>
              {rcpt.remarks ? (
                <div className="text3" style={{ fontSize: 11, marginBottom: 6 }}>
                  {rcpt.remarks}
                </div>
              ) : null}
              {/* `.tbl-wrap` so this nested table scrolls inside its own box
                instead of widening the page (styling skill Rule 1). */}
              {cancelled ? (
                <div className="text3" style={{ fontSize: 11 }}>
                  Its lines were cancelled with it.
                </div>
              ) : (
                <div className="tbl-wrap">
                  <table className="innovic-table" style={{ fontSize: 11 }}>
                    <thead>
                      <tr>
                        {/* POL = the CUSTOMER's own PO line number, read off the
                        challan line this receipt row books against. */}
                        <th style={{ color: 'var(--purple)' }}>POL</th>
                        <th>Item Code · Name</th>
                        <th className="th-num">Received</th>
                        <th className="th-num">Deviated</th>
                        <th>Deviation Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rcpt.lines.map((rl) => {
                        const ll = lineLookup.get(rl.deliveryChallanLineId);
                        return (
                          <tr key={rl.id} className={cancelled ? 'row-cancelled' : undefined}>
                            <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
                              {ll?.clientPoLineNo ?? '—'}
                            </td>
                            <td>
                              {/* Live master code/name first, issue-time snapshot as
                              the fallback — the Lines table already did this, so
                              a renamed item read two ways on one page. */}
                              {/* And the drawing revision the same way, so a part
                              does not read as "IN-IT-0007/B" in the Lines table
                              and as bare "IN-IT-0007" here. */}
                              <span className="mono">
                                {itemCodeWithRev(
                                  ll?.itemCode ?? ll?.itemCodeText,
                                  ll?.itemRevision,
                                )}
                              </span>
                              {(ll?.itemName ?? ll?.itemNameText) ? (
                                <span className="text3" style={{ marginLeft: 6 }}>
                                  {ll?.itemName ?? ll?.itemNameText}
                                </span>
                              ) : null}
                            </td>
                            <td className="mono td-num" style={{ color: 'var(--green2)' }}>
                              {Number(rl.receivedQty)}
                            </td>
                            <td className="mono td-num" style={{ color: 'var(--red2)' }}>
                              {Number(rl.rejectedQty)}
                            </td>
                            <td className="text3">{rl.rejectReason ?? '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
