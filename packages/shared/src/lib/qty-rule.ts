import { z } from 'zod';

// Decimals follow the unit (fix wave 2, step 2b — finding S9).
//
// ERPNext keeps one flag on every UOM: "Must be whole number". A quantity in a
// whole-number unit (NOS, SET …) is refused a fraction; any other unit (KGS,
// MTR, LTR …) takes decimals. This file is that rule, once, for web + API.
//
// How many decimals: every stored quantity column is numeric(14,3) (0153 store
// ledger, 0172 purchase chain, 0184 DC / NC / BOM / OSP link), so a quantity
// keeps at most 3 places. Before 0184 some columns kept 2 (0.125 KG → 0.13)
// or none (12.5 KG → 12), and a BOM child qty that rounded to 0 was skipped.

/** Decimal places every stored quantity keeps — the database's numeric(14,3). */
export const QTY_DECIMALS = 3;
/** The matching `step` for a number input. */
export const QTY_STEP = '0.001';

/** Units that count pieces — ERPNext "Must be whole number". Anything not
 *  listed (KGS, KG, MTR, LTR …, or a blank unit) takes decimals. */
export const WHOLE_NUMBER_UOMS: readonly string[] = ['NOS', 'PCS', 'SET', 'LOT'];

/** True when the unit only moves in whole pieces. Case / spaces ignored. */
export function isWholeNumberUom(uom: string | null | undefined): boolean {
  if (!uom) return false;
  return WHOLE_NUMBER_UOMS.includes(uom.trim().toUpperCase());
}

/** Round to the stored 3 decimal places (also removes 0.1 + 0.2 float drift). */
export function roundQty(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** True when `n` has no more than 3 decimal places. */
export function hasQtyPrecision(n: number): boolean {
  return Number.isFinite(n) && Math.abs(roundQty(n) - n) < 1e-9;
}

/** The `step` for a qty input in this unit: 1 for NOS / SET, 0.001 otherwise. */
export function qtyStepForUom(uom: string | null | undefined): string {
  return isWholeNumberUom(uom) ? '1' : QTY_STEP;
}

/**
 * Why `qty` does not fit `uom`, or null when it does. Checks only the unit rule
 * (whole number / 3 decimals) — "more than 0" is each form's own rule.
 *   qtyUomProblem(2.5, 'NOS')          → 'Qty (2.5) must be a whole number — the unit is NOS.'
 *   qtyUomProblem(1.2345, 'KGS')       → 'Qty (1.2345) can have at most 3 decimal places.'
 */
export function qtyUomProblem(
  qty: number,
  uom: string | null | undefined,
  label = 'Qty',
): string | null {
  if (!Number.isFinite(qty)) return `${label} must be a number.`;
  if (isWholeNumberUom(uom) && !Number.isInteger(qty)) {
    return `${label} (${qty}) must be a whole number — the unit is ${String(uom).trim().toUpperCase()}.`;
  }
  if (!hasQtyPrecision(qty)) {
    return `${label} (${qty}) can have at most ${QTY_DECIMALS} decimal places.`;
  }
  return null;
}

/** A positive quantity with at most 3 decimals — the Zod twin of numeric(14,3).
 *  The whole-number check needs the unit, so it is added where the unit is
 *  known (a line's superRefine, or the service that reads the item). */
export const positiveQtySchema = z
  .number()
  .positive()
  .refine(hasQtyPrecision, { message: `Qty can have at most ${QTY_DECIMALS} decimal places` });

/** Same as positiveQtySchema but accepts a numeric string (form posts). */
export const positiveQtyCoerceSchema = z.coerce
  .number()
  .positive()
  .refine(hasQtyPrecision, { message: `Qty can have at most ${QTY_DECIMALS} decimal places` });
