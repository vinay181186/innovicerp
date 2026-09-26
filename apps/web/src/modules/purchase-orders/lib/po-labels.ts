// Screen words for the PO codes (wording clean-up 2026-09-26). Display only —
// the stored codes (`partial`, `job_work`, `sgst_cgst`, …) are unchanged; these
// maps only decide what the user reads.

import type { PoStatus, PoType } from '@innovic/shared';

export const PO_STATUS_LABELS: Record<PoStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  partial: 'Partly Received',
  qc_pending: 'QC Pending',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export const PO_TYPE_LABELS: Record<PoType, string> = {
  standard: 'Standard',
  job_work: 'Job Work',
  outsource: 'Outsource',
  service: 'Service',
};

const TAX_TYPE_LABELS: Record<string, string> = {
  sgst_cgst: 'SGST + CGST',
  igst: 'IGST',
  none: 'None',
};

/** Status label for a value that may arrive as a plain string (form state). */
export function poStatusLabel(status: string): string {
  return (PO_STATUS_LABELS as Record<string, string>)[status] ?? status.replaceAll('_', ' ');
}

/** Tax Type is a free string column; unknown values are shown as stored. */
export function taxTypeLabel(taxType: string): string {
  return TAX_TYPE_LABELS[taxType] ?? taxType;
}
