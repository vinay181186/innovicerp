// THE one quantity display format (owner decision 2026-11-03).
// A whole number stays whole (12, not 12.00); a real fraction shows up to the
// 3 places every stored quantity keeps (QTY_DECIMALS, numeric(14,3)) with no
// trailing zeros: 1.5, 0.125, 2.333. Indian digit grouping (1,25,000).
// QUANTITIES ONLY — money (rate, amount, value) keeps its own 2-decimal format.

import { QTY_DECIMALS } from '@innovic/shared';

/** Quantity for display. A number or a numeric string (Postgres `numeric`
 *  arrives as text); null / blank / not a number → `empty`. */
export function fmtQty(v: number | string | null | undefined, empty = '—'): string {
  if (v == null || (typeof v === 'string' && v.trim() === '')) return empty;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return empty;
  const s = n.toLocaleString('en-IN', { maximumFractionDigits: QTY_DECIMALS });
  // -0.0001 rounds to "-0" — a quantity never reads minus nothing.
  return s === '-0' ? '0' : s;
}
