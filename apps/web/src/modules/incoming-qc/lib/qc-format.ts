// Shared Incoming QC formatters (ADR-199 split). Pulled out of routes/index.tsx
// so the page, the pending columns and the completed columns can all read the
// same waiting-time wording and QC-result colours without any file growing past
// the 400-line ceiling. Tokens only — no hard-coded colours.

import type { IncomingQcCompletedRow } from '@innovic/shared';

/** Days Waiting chip: badge classes, no hard-coded colours. */
export function waitBadge(days: number): string {
  if (days >= 3) return 'b-red';
  if (days >= 2) return 'b-amber';
  return 'b-green';
}

/** "1 day" / "3 days" — the one waiting-time format on every QC screen. */
export function daysText(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`;
}

/** Response-time colour for the completed feed's "Days to Inspect". */
export function respColor(days: number | null): string {
  if (days === null) return 'var(--text3)';
  if (days <= 1) return 'var(--green)';
  if (days <= 2) return 'var(--amber)';
  return 'var(--red)';
}

/** QC result colour (accepted green, partial amber, rejected red). */
export function dispColor(d: IncomingQcCompletedRow['disposition']): string {
  if (d === 'Rejected') return 'var(--red)';
  if (d === 'Partial Accept') return 'var(--amber)';
  return 'var(--green)';
}

/** Screen word for the stored QC result code. */
export function dispLabel(d: IncomingQcCompletedRow['disposition']): string {
  return d === 'Partial Accept' ? 'Partly Accepted' : d;
}
