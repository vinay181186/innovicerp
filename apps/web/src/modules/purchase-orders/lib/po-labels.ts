// Screen words for the PO codes (wording clean-up 2026-09-26). Display only —
// the stored codes (`partial`, `job_work`, `sgst_cgst`, …) are unchanged; these
// maps only decide what the user reads.

import { type PoStatus, type PoTaxType, type PoType, poTaxTypeSchema } from '@innovic/shared';

/** ADR-222 — a purchase order has FOUR statuses on screen: Draft, Open, Closed,
 *  Cancelled. `partial` and `qc_pending` are retired codes that nothing writes
 *  any more, but seven live rows still hold them, so both must keep rendering —
 *  as "Open", because that is what they mean: an order still being worked. They
 *  stay in the map (and in the PoStatus enum) only so those old rows render; do
 *  not offer either as a choice anywhere.
 *
 *  THE ONE COPY. The DC "Against JW PO / DC" picker and the Supply Chain
 *  dashboard each used to keep their own hand-typed copy of this map, and both
 *  drifted (the picker still read "Partly Received"; the dashboard labelled a
 *  draft PO "Open"). Import this — never retype it. */
export const PO_STATUS_LABELS: Record<PoStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  partial: 'Open',
  qc_pending: 'Open',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

/** The only PO statuses a filter / dropdown may OFFER (ADR-222). The retired
 *  `partial` / `qc_pending` render as Open but are never selectable. */
export const PO_STATUS_CHOICES: readonly PoStatus[] = ['draft', 'open', 'closed', 'cancelled'];

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

/** The form's Tax Type select value as the fixed list the API accepts (S1):
 *  'sgst_cgst' | 'igst', or undefined for None / anything else. */
export function toPoTaxType(v: string | null | undefined): PoTaxType | undefined {
  const parsed = poTaxTypeSchema.safeParse(v?.trim());
  return parsed.success ? parsed.data : undefined;
}

/** Tax Type — one fixed list since 0182; any other stored value shows as is.
 *  No tax type (NULL / blank) reads "None" — the same word the form offers. */
export function taxTypeLabel(taxType: string | null | undefined): string {
  if (!taxType) return 'None';
  return TAX_TYPE_LABELS[taxType] ?? taxType;
}
