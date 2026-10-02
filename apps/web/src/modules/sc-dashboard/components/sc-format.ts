// Supply Chain Dashboard — shared pure formatters for the page and its column
// builders. No JSX here.

export function inr(n: number | null): string {
  if (n == null) return '';
  return Math.round(n).toLocaleString('en-IN');
}

// Legacy renders the PO status verbatim ('Open' / 'Partly Received' / 'Closed' /
// 'QC Pending'); our status column is a lower-snake enum, so map it back to the
// legacy labels + the b-* badge classes (L16891, L16995).
export function statusBadge(s: string): { cls: string; label: string } {
  if (s === 'closed') return { cls: 'b-green', label: 'Closed' };
  if (s === 'partial') return { cls: 'b-amber', label: 'Partly Received' };
  if (s === 'qc_pending') return { cls: 'b-amber', label: 'QC Pending' };
  if (s === 'cancelled') return { cls: 'b-grey', label: 'Cancelled' };
  return { cls: 'b-blue', label: 'Open' };
}

/** PO Status tick list for server Sort & Filter: stored value + the label shown. */
export const PO_STATUS_OPTIONS = (
  ['open', 'partial', 'qc_pending', 'closed', 'cancelled'] as const
).map((value) => ({ value, label: statusBadge(value).label }));
