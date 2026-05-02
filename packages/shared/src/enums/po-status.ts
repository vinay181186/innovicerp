// Purchase Order header/line status. Mirrors legacy renderPOMaster
// status filters (legacy lines 2815-2817 + 3806). Lowercase/normalised.
export const PO_STATUSES = [
  'draft',
  'open',
  'partial',
  'qc_pending',
  'closed',
  'cancelled',
] as const;
export type PoStatus = (typeof PO_STATUSES)[number];
