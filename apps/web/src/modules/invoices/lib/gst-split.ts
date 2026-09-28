// The ONE SGST + CGST split for an invoice's GST amount — used by the create
// page, the invoice detail and the print, so all three show the same paise.
// SGST = GST / 2 rounded to paise; CGST = the rest, so SGST + CGST is always
// exactly the GST amount (₹10.01 → 5.01 + 5.00, never 5.005 + 5.005).

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function splitGst(gstAmount: number): { sgst: number; cgst: number } {
  const sgst = round2(gstAmount / 2);
  return { sgst, cgst: round2(gstAmount - sgst) };
}
