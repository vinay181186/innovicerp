// ADR-243 — the tax rows of an SO / JWSO money roll-up, shared by the SO and
// JWSO forms, detail pages and prints so all of them label the same figures
// the same way. The figures themselves come from computeGstTotals
// (@innovic/shared lib/gst-totals.ts) or the server's `totals`.
//
//   GST 0%          → no tax rows (Round-off + Grand Total still shown).
//   IGST            → one row, IGST @ 18%.
//   SGST + CGST     → two rows, CGST @ 9% then SGST @ 9% (owner layout).
//   null tax type   → State unknown: figured as SGST + CGST (the screen warns).

import { halfGstRate, type ServicePoTaxType } from '@innovic/shared';
import { inrFormat } from '@/lib/print/doc-print';

export interface GstRowSource {
  gstPercent: number;
  taxType: ServicePoTaxType | null;
  cgst: number;
  sgst: number;
  igst: number;
}

export function gstTaxRows(t: GstRowSource): { label: string; amount: number }[] {
  if (!(t.gstPercent > 0)) return [];
  if (t.taxType === 'igst') return [{ label: `IGST @ ${t.gstPercent}%`, amount: t.igst }];
  const half = halfGstRate(t.gstPercent);
  return [
    { label: `CGST @ ${half}%`, amount: t.cgst },
    { label: `SGST @ ${half}%`, amount: t.sgst },
  ];
}

/** Round-off with its sign: +0.35 / −0.20 / 0.00. */
export function signedRoundOff(n: number): string {
  const abs = inrFormat(Math.abs(n));
  if (Math.round(n * 100) === 0) return inrFormat(0);
  return n > 0 ? `+${abs}` : `−${abs}`;
}

/** The Tax Type text shown next to the Place of Supply. */
export function taxTypeLabel(taxType: ServicePoTaxType | null): string {
  return taxType === 'igst' ? 'IGST' : 'CGST + SGST';
}

/** The orange note an SO / JWSO screen shows when a customer is chosen but its
 *  State is unknown (the figures then come out as CGST + SGST). Screen only. */
export const ORDER_STATE_MISSING_NOTE =
  "Tax type not decided — fill the customer's State / GSTIN in Client Master (or our GSTIN in Settings → Company). Worked out as CGST + SGST for now.";
