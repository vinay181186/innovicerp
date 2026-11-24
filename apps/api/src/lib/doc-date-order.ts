// ADR-320 / CLAUDE.md §26.8 — a document is never dated before the document it
// comes from (PR → PO → GRN, SO → Job Card). The ONE check every save uses.
// Dates are calendar dates 'YYYY-MM-DD', so plain string order is date order.
// A missing parent date (no parent document) is not a refusal.
import { ValidationError } from './errors';

/** Throws ValidationError(message) when childDate is earlier than parentDate. */
export function assertNotBefore(
  childDate: string,
  parentDate: string | null | undefined,
  message: string,
): void {
  if (!parentDate) return;
  if (childDate.slice(0, 10) < parentDate.slice(0, 10)) throw new ValidationError(message);
}

/** The latest of the given parents (by date), or null when there are none. */
export function latestDated<T extends { date: string | null }>(rows: readonly T[]): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (r.date && (!best?.date || r.date > best.date)) best = r;
  }
  return best;
}
