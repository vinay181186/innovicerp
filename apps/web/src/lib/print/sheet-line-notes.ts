// Free-text notes printed under a sheet line's item name (GRN / Party GRN:
// Vendor Challan No., Deviation Reason, QC Remarks). The sheet's item cell has
// one labelled slot (`descLabel` bold + `description`), so the first note takes
// it and any further note follows inline as "· Label: text". Full text, never
// cut. Returns {} when every note is blank, so the line prints as before.

import type { SheetLine } from './sheet-print';

export function sheetLineNotes(
  notes: { label: string; text: string | null | undefined }[],
): Pick<SheetLine, 'description' | 'descLabel'> {
  const filled = notes
    .map((n) => ({ label: n.label, text: n.text?.trim() ?? '' }))
    .filter((n) => n.text !== '');
  const [first, ...rest] = filled;
  if (!first) return {};
  return {
    descLabel: first.label,
    description: [first.text, ...rest.map((n) => `${n.label}: ${n.text}`)].join(' · '),
  };
}
