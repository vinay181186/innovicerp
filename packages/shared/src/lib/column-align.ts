// THE alignment rule (owner 2026-11-06, ADR-280) — one place for every table.
//
//   Text and codes          left     Item Name, Item Code, SO No., Client, Remarks
//   Qty and other counts    centre   Order Qty, Pending, Lead Days, Ops
//   Money                   right    Rate, Amount, Order Value, Total Cost
//   Short fixed values      centre   Dates, Status, UOM, Sr No, POL, Op, Rev, Action
//
// The heading aligns with its values. A screen does not choose: the table asks
// this rule. Excel asks it too (apps/api/src/lib/excel.ts). Hand-built tables and
// prints use the classes / columns named in CLAUDE.md §24.

export type ColumnAlign = 'left' | 'center' | 'right';

/** A money figure is a numeric column whose heading says money. "Rate Source" or
 *  "Cost Centre" hold text, so they never reach this test as numeric columns. */
const MONEY_WORDS =
  /\b(rate|amount|value|price|cost|subtotal|taxable|tax|gst|cgst|sgst|igst|tds|paid|round.?off|invoice total|grand total|not due)\b|₹|^\d+-\d+$|^\d+\+$/i;

/** A percentage is a count however it is named: GST %, Deviation Rate. */
const PERCENT_WORDS = /%|\b(deviation|rejection|defect|pass|first.pass) rate\b/i;

/** Always a count, even on a column that does not declare itself numeric. */
const COUNT_WORDS = /\b(qty|days?|hours?|hrs)\b|%/i;

/** Dates, statuses and the short codes that head a row. */
const SHORT_FIXED =
  /(^|\s)(date|time|due|status|uom|rev|action|created on|raised on|added on|decided on|changed at|uploaded at|deleted at|qc at)$|^(sr no\.?|sr|#|pol|ln|op|line no\.?)$/i;

export function isMoneyHeading(heading: string): boolean {
  return !PERCENT_WORDS.test(heading) && MONEY_WORDS.test(heading.trim());
}

export function columnAlign(input: {
  /** The column's heading text. */
  heading: string;
  /** The column holds a number (the fit table's `num` kind, Excel's number type). */
  numeric?: boolean;
  /** The column holds money under a heading that does not say so ("Total"). */
  money?: boolean;
  /** The column holds a date, a status chip, buttons or an in-cell control. */
  fixed?: boolean;
}): ColumnAlign {
  const heading = input.heading.trim();
  if (input.money) return 'right';
  if (input.numeric) return isMoneyHeading(heading) ? 'right' : 'center';
  if (input.fixed || COUNT_WORDS.test(heading) || SHORT_FIXED.test(heading)) return 'center';
  return 'left';
}
