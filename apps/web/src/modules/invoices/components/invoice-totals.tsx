// New Invoice totals — right-aligned under the Amount column, one per row.
// ADR-248: the same roll-up the server stores (computeGstTotals) — Subtotal in
// whole paise, GST rounded to paise, CGST + SGST (or IGST) by the Tax Type,
// Grand Total brought to the rupee — so Subtotal + tax rows + Round-off = Grand
// Total exactly. A new invoice is always on the rounded rule, so the rows come
// straight from roundedRuleTaxRows (the same rows the print carries).

import { computeGstTotals, type InvoiceTaxType } from '@innovic/shared';
import { Fragment } from 'react';
import { inrFormat } from '@/lib/print/doc-print';
import { signedRoundOff } from '@/modules/sales-orders/lib/gst-rows';
import { roundedRuleTaxRows } from '../lib/gst-split';

export function InvoiceTotals({
  subtotal,
  gstPercent,
  taxType,
}: {
  /** Raw Σ qty × rate of the cards (pre-save preview; server recomputes). */
  subtotal: number;
  gstPercent: number;
  taxType: InvoiceTaxType;
}): React.JSX.Element {
  const totals = computeGstTotals({ subtotal, gstPercent, taxType });
  const taxRows = roundedRuleTaxRows(gstPercent, totals.gstTotal, taxType);
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 140px',
        justifyContent: 'end',
        columnGap: 'var(--sp-3)',
        rowGap: 'var(--sp-1)',
        marginTop: 12,
        textAlign: 'right',
      }}
    >
      <span className="text3">Subtotal</span>
      <b className="mono fw-700 text2">₹{inrFormat(totals.subtotal)}</b>
      {taxRows.map((l) => (
        <Fragment key={l.label}>
          <span className="text3">{l.label}</span>
          <b className="mono fw-700 amber">₹{inrFormat(l.amount)}</b>
        </Fragment>
      ))}
      <span className="text3">Round-off</span>
      <b className="mono fw-700 text2">{signedRoundOff(totals.roundOff)}</b>
      <span className="text3">Grand Total</span>
      <b className="mono fw-700 green">₹{inrFormat(totals.grandTotal)}</b>
    </div>
  );
}
