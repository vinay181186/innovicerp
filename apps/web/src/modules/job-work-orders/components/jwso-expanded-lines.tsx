// The JWSO's line items + remarks, revealed in place under an opened row in the
// JWSO Master list (ADR-199 ▸ expand). Its own fetch — the list endpoint carries
// no lines, so only a row actually opened costs a request. Split out of
// routes/list.tsx so that file stays under the 400-line ceiling.
//
// Shows the line detail the list row cannot: Ln · Item (CODE/REV + name) ·
// Customer RM · Accepted (ADR-203) · Material · Drawing No. · Order Qty ·
// Dispatched · Pending · UOM · [Rate] · Due Date · JWSO Status. The JWSO-level Remarks sit below the table (the
// retired card showed them on its meta line). No per-line Edit: it opened the
// same JWSO edit page as the row's ⋯ Edit, so it was a duplicate.

import { type JobWorkOrderDetail } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { fmtDate } from '@/lib/date';
import { ItemBadge, ItemThumbnailCell, ItemThumbnailHeader } from '@/components/shared/item-badge';
import { SoStatusBadge } from '@/modules/sales-orders/components/so-status-badge';
import { useJobWorkOrder } from '../api';

export function JwsoExpandedLines({ jwId }: { jwId: string }): React.JSX.Element {
  const { data, isLoading, isError, error } = useJobWorkOrder(jwId);
  if (isLoading)
    return (
      <div style={{ padding: '12px 18px', fontSize: 12, color: 'var(--text3)' }}>
        <Loader2 size={12} className="inline animate-spin" /> Loading lines…
      </div>
    );
  if (isError || !data)
    return (
      <div style={{ padding: '12px 18px', fontSize: 12, color: 'var(--red2)' }}>
        {error instanceof Error ? error.message : 'Could not load JWSO detail. Try again.'}
      </div>
    );
  return <JwLinesTable jw={data} />;
}

function JwLinesTable({ jw }: { jw: JobWorkOrderDetail }): React.JSX.Element {
  // Money hidden for L1 Viewers: the API nulls the JWSO GST % + line rates, so
  // the Rate column is dropped here too. Told by the server, not inferred from a
  // null money field (a null also means "no value yet").
  const priceHidden = jw.priceVisible === false;
  // Ln · thumbnail · Item (badge) · Customer RM · Accepted · Material ·
  // Drawing No. · Qty · Dispatched · Pending · UOM · [Rate] · Due Date ·
  // JWSO Status.
  const cols = 14 - (priceHidden ? 1 : 0);
  return (
    <div style={{ padding: '8px 12px 8px 36px' }}>
      <div
        style={{
          fontSize: 11,
          color: 'var(--blue)',
          fontFamily: 'var(--mono)',
          fontWeight: 700,
          marginBottom: 6,
        }}
      >
        Line Items
      </div>
      <div className="tbl-wrap">
        <table className="innovic-table tbl-grid tbl-compact" style={{ margin: 0 }}>
          <thead>
            <tr style={{ background: 'var(--bg4)' }}>
              <th style={{ width: 36 }}>Ln</th>
              <ItemThumbnailHeader />
              <th>Item</th>
              <th>Customer RM</th>
              <th className="th-num" title="Customer RM accepted by Incoming QC on this line">
                Accepted
              </th>
              <th>Material</th>
              <th>Drawing No.</th>
              <th className="th-num">Order Qty</th>
              <th className="th-num" style={{ color: 'var(--green2)' }}>
                Dispatched
              </th>
              <th className="th-num">Pending</th>
              <th>UOM</th>
              {priceHidden ? null : <th className="th-num">Rate</th>}
              <th>Due Date</th>
              <th>JWSO Status</th>
            </tr>
          </thead>
          <tbody>
            {jw.lines.length === 0 ? (
              <tr>
                <td colSpan={cols} className="empty-state">
                  No lines yet.
                </td>
              </tr>
            ) : (
              jw.lines.map((l) => {
                const balance = Math.max(0, l.orderQty - l.returnedQty);
                return (
                  <tr key={l.id} style={{ background: 'var(--bg)' }}>
                    <td className="mono fw-700" style={{ color: 'var(--blue)' }}>
                      {l.lineNo}
                    </td>
                    {/* CODE/REV — the client's drawing revision typed on this line
                        travels with the code (the badge formats it via
                        itemCodeWithRev). */}
                    <ItemThumbnailCell imagePath={l.itemImagePath} alt={l.partName} />
                    <td>
                      <ItemBadge
                        size="row"
                        showImage={false}
                        code={l.itemCodeText}
                        name={l.partName}
                        revision={l.revision}
                        imagePath={l.itemImagePath}
                      />
                    </td>
                    <td>
                      {l.rmItemCode ? (
                        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                          {l.rmItemCode}
                        </span>
                      ) : (
                        <span className="text3">—</span>
                      )}
                    </td>
                    <td className="mono td-num">{l.rmItemCode ? l.rmAcceptedQty : '—'}</td>
                    <td className="text2" style={{ fontSize: 11 }}>
                      {l.material ?? '—'}
                    </td>
                    <td className="mono" style={{ fontSize: 11, color: 'var(--purple)' }}>
                      {l.drawingNo ?? '—'}
                    </td>
                    <td className="mono fw-700 td-num" style={{ fontSize: 14 }}>
                      {l.orderQty}
                    </td>
                    <td
                      className="mono fw-700 td-num"
                      style={{ color: l.returnedQty > 0 ? 'var(--green)' : 'var(--text3)' }}
                    >
                      {l.returnedQty}
                    </td>
                    <td
                      className="mono fw-700 td-num"
                      style={{ color: balance > 0 ? 'var(--red)' : 'var(--green)' }}
                    >
                      {balance}
                    </td>
                    <td className="text3" style={{ fontSize: 11, textTransform: 'uppercase' }}>
                      {l.uom}
                    </td>
                    {priceHidden ? null : (
                      <td className="mono td-num" style={{ fontSize: 11 }}>
                        {l.rate}
                      </td>
                    )}
                    <td className="text2" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                      {fmtDate(l.dueDate)}
                    </td>
                    <td>
                      <SoStatusBadge status={l.status} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {jw.remarks ? (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text2)' }}>
          <span className="mono fw-700" style={{ color: 'var(--text3)' }}>
            Remarks:{' '}
          </span>
          <span title={jw.remarks}>{jw.remarks}</span>
        </div>
      ) : null}
    </div>
  );
}
