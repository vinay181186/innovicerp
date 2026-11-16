// ADR-302 — a line's money BEFORE GST, on the Sales Order, the Job Work Sales
// Order and the Purchase Order (owner 2026-11-16).
//
//   Unit Value (Basic)  = the line's stored rate (₹ per piece, no GST)
//   Total Value (Basic) = Qty × Unit Value (Basic)
//
// ONE rule and ONE pair of labels for the detail pages, the create / edit
// forms, the prints and the server's Subtotal, so no screen works the figure
// out its own way. A cancelled line carries no value: it is left out of the
// Subtotal, so its Total Value (Basic) reads "—" and the column adds up to the
// Subtotal exactly (rate is 2 dp and qty is whole, so qty × rate is exact to
// the paisa; a PO line's decimal qty (KGS) is rounded to the paisa per line
// for display, and the Subtotal is rounded once on the sum, as before).
//
// Stored names stay `rate` / `amount` in code. The Tax Invoice and JW Invoice
// keep their own `Rate` / `Amount` words (tax documents, not in scope), and
// Excel import files keep their `Rate` column so old upload files still work.

export const UNIT_VALUE_BASIC_LABEL = 'Unit Value (Basic)';
export const TOTAL_VALUE_BASIC_LABEL = 'Total Value (Basic)';

/** Qty × rate, rounded to the paisa. Null / blank / non-numbers count as 0. */
export function lineBasicValue(
  qty: number | string | null | undefined,
  rate: number | string | null | undefined,
): number {
  const q = Number(qty ?? 0);
  const r = Number(rate ?? 0);
  if (!Number.isFinite(q) || !Number.isFinite(r)) return 0;
  return Math.round(q * r * 100) / 100;
}

/** Σ Total Value (Basic) over the lines that are not cancelled — the order's
 *  Subtotal. Lines without a status (a PO line) all count. */
export function linesBasicTotal(
  lines: ReadonlyArray<{
    qty: number | string | null | undefined;
    rate: number | string | null | undefined;
    status?: string | null | undefined;
  }>,
): number {
  // Summed unrounded, then rounded once — exactly what the SO / JWSO / PO
  // Subtotal did before ADR-302, so no stored total moves by a paisa.
  const raw = lines
    .filter((l) => l.status !== 'cancelled')
    .reduce((sum, l) => {
      const q = Number(l.qty ?? 0);
      const r = Number(l.rate ?? 0);
      return Number.isFinite(q) && Number.isFinite(r) ? sum + q * r : sum;
    }, 0);
  return Math.round(raw * 100) / 100;
}
