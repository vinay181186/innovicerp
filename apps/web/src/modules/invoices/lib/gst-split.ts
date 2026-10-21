// The ONE place that decides how an invoice's GST amount splits into tax rows,
// and whether a Round-off row follows — for the Tax Invoice (create preview,
// detail, print) and the JW Invoice (create preview, expand, print), so every
// screen and paper shows the same paise.
//
// Two rules, chosen by the invoice's stored roundOff (ADR-248, 0214). This file
// is the ONLY place that reads that sentinel:
//   roundOff NULL  → issued before 0214: the LEGACY rows, exactly as that
//                    document always printed; no Round-off line.
//   roundOff set   → the ADR-243 rule (computeGstTotals): CGST = half the GST
//                    rounded in whole paise, SGST = the rest, IGST = all of it;
//                    rows and labels from gstTaxRows (CGST before SGST, owner
//                    layout), then a Round-off line.
//
// A create preview has no stored invoice yet — it calls roundedRuleTaxRows
// directly (every new invoice is on the new rule).

import { type InvoiceTaxType } from '@innovic/shared';
import { gstTaxRows } from '@/modules/sales-orders/lib/gst-rows';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** LEGACY Tax Invoice split (issued before ADR-248). SGST = GST / 2 rounded to
 *  paise; CGST = the rest, so SGST + CGST is always exactly the GST amount
 *  (₹10.01 → 5.01 + 5.00, never 5.005 + 5.005). */
export function splitGst(gstAmount: number): { sgst: number; cgst: number } {
  const sgst = round2(gstAmount / 2);
  return { sgst, cgst: round2(gstAmount - sgst) };
}

/** One tax row: "CGST @ 9%" and its amount. */
export interface InvoiceTaxRow {
  label: string;
  amount: number;
}

/** The tax rows of one invoice, plus its Round-off — null = no Round-off line
 *  (a legacy invoice, issued before round-off existed). */
export interface InvoiceTaxSplit {
  rows: InvoiceTaxRow[];
  roundOff: number | null;
}

/** ADR-243 / ADR-248 rule — the same paise as computeGstTotals and the GST
 *  Sales Register, labelled by gstTaxRows. GST 0% → no tax rows. Unknown tax
 *  type → CGST + SGST (as computeGstTotals works it out). */
export function roundedRuleTaxRows(
  gstPercent: number,
  gstAmount: number,
  taxType: InvoiceTaxType | null | undefined,
): InvoiceTaxRow[] {
  const gstPaise = Math.round(gstAmount * 100);
  const isIgst = taxType === 'igst';
  const cgstPaise = isIgst ? 0 : Math.round(gstPaise / 2);
  const sgstPaise = isIgst ? 0 : gstPaise - cgstPaise;
  return gstTaxRows({
    gstPercent,
    taxType: taxType ?? null,
    cgst: cgstPaise / 100,
    sgst: sgstPaise / 100,
    igst: isIgst ? gstPaise / 100 : 0,
  });
}

interface StoredInvoiceTax {
  gstPercent: number;
  gstAmount: number;
  taxType: InvoiceTaxType | null | undefined;
  roundOff: number | null | undefined;
}

/** Tax Invoice tax rows. `roundOff` null = legacy invoice, shown exactly as
 *  issued; non-null = new invoice on the rounded rule, with its Round-off. */
export function invoiceTaxSplit(args: StoredInvoiceTax): InvoiceTaxSplit {
  const { gstPercent, gstAmount, taxType, roundOff } = args;
  if (roundOff != null) {
    return { rows: roundedRuleTaxRows(gstPercent, gstAmount, taxType), roundOff };
  }
  // Legacy — unchanged: the split follows the Tax Type; an invoice raised
  // before the Tax Type was recorded shows the single GST figure.
  if (taxType === 'igst') {
    return { rows: [{ label: `IGST @ ${gstPercent}%`, amount: gstAmount }], roundOff: null };
  }
  if (taxType === 'sgst_cgst') {
    const s = splitGst(gstAmount);
    return {
      rows: [
        { label: `SGST @ ${gstPercent / 2}%`, amount: s.sgst },
        { label: `CGST @ ${gstPercent / 2}%`, amount: s.cgst },
      ],
      roundOff: null,
    };
  }
  return { rows: [{ label: `GST @ ${gstPercent}%`, amount: gstAmount }], roundOff: null };
}

/** JW Invoice tax rows. `roundOff` null = issued before ADR-248: the rows
 *  exactly as the JW Invoice print always carried them (SGST row first; CGST =
 *  half the GST rounded in paise, SGST = the rest; no tax type → one GST row).
 *  Non-null = the rounded rule, with its Round-off. */
export function jwInvoiceTaxSplit(args: StoredInvoiceTax): InvoiceTaxSplit {
  const { gstPercent, gstAmount, taxType, roundOff } = args;
  if (roundOff != null) {
    return { rows: roundedRuleTaxRows(gstPercent, gstAmount, taxType), roundOff };
  }
  if (gstPercent <= 0) return { rows: [], roundOff: null };
  if (taxType === 'igst') {
    return { rows: [{ label: `IGST @ ${gstPercent}%`, amount: gstAmount }], roundOff: null };
  }
  if (taxType === 'sgst_cgst') {
    const gstPaise = Math.round(gstAmount * 100);
    const cgstPaise = Math.round(gstPaise / 2);
    return {
      rows: [
        { label: `SGST @ ${gstPercent / 2}%`, amount: (gstPaise - cgstPaise) / 100 },
        { label: `CGST @ ${gstPercent / 2}%`, amount: cgstPaise / 100 },
      ],
      roundOff: null,
    };
  }
  return { rows: [{ label: `GST @ ${gstPercent}%`, amount: gstAmount }], roundOff: null };
}
