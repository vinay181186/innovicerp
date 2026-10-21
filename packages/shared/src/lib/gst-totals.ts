// The ONE order/invoice money roll-up (ADR-241): Subtotal → CGST + SGST or
// IGST → Round-off → Grand Total. Used by the SO and JWSO server totals, their
// create/edit forms, detail pages and prints, so every place shows the same
// paise. (Invoices keep their own stored GST; their round-off is a later step.)
//
//   GST        = Subtotal × GST% / 100, rounded to paise.
//   CGST/SGST  = CGST = GST / 2 rounded to paise; SGST = the rest, so the two
//                always add up to the GST. Same paise as the GST Sales Register
//                (CGST = ROUND(gst/2, 2)) and the JW Invoice print.
//   IGST       = the whole GST.
//   Round-off  = Grand Total brought to the nearest whole rupee (0.50 up),
//                shown on its own line (−0.50 … +0.50).
//
// All maths is in whole paise so 0.1 + 0.2 never drifts.
//
// Tax type null = the customer's state is unknown: the figures are worked out
// as CGST + SGST (our own State) and the screen warns.

import type { ServicePoTaxType } from '../schemas/service-po';

export interface GstTotals {
  subtotal: number;
  gstPercent: number;
  /** The split used; null only when the caller passed null (state unknown —
   *  figures are then SGST + CGST). */
  taxType: ServicePoTaxType | null;
  cgst: number;
  sgst: number;
  igst: number;
  gstTotal: number;
  roundOff: number;
  grandTotal: number;
}

const toPaise = (n: number): number => Math.round((Number.isFinite(n) ? n : 0) * 100);
const fromPaise = (p: number): number => p / 100;

export function computeGstTotals(args: {
  subtotal: number;
  gstPercent: number;
  taxType: ServicePoTaxType | null | undefined;
}): GstTotals {
  const gstPercent = Number.isFinite(args.gstPercent) ? args.gstPercent : 0;
  const sub = toPaise(args.subtotal);
  const gst = Math.round((sub * gstPercent) / 100);
  const isIgst = args.taxType === 'igst';
  const cgst = isIgst ? 0 : Math.round(gst / 2);
  const sgst = isIgst ? 0 : gst - cgst;
  const igst = isIgst ? gst : 0;
  const exact = sub + gst;
  // Nearest rupee, 0.50 up (also for a negative total).
  const rounded = Math.floor(exact / 100 + 0.5) * 100;
  return {
    subtotal: fromPaise(sub),
    gstPercent,
    taxType: args.taxType ?? null,
    cgst: fromPaise(cgst),
    sgst: fromPaise(sgst),
    igst: fromPaise(igst),
    gstTotal: fromPaise(gst),
    roundOff: fromPaise(rounded - exact),
    grandTotal: fromPaise(rounded),
  };
}

/** Half a GST rate for the CGST / SGST labels: 18 → 9, 5 → 2.5. */
export function halfGstRate(gstPercent: number): number {
  return Math.round(gstPercent * 50) / 100;
}
