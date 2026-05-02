// QC status on a goods_receipt_note_lines row. Inline on the line per
// ADR-015 #8 — legacy data co-locates qc fields with the receipt row.
// Legacy values: 'Pending' / 'Completed'. `in_progress` is a forward
// state for partial-QC scenarios.
export const GRN_QC_STATUSES = ['pending', 'in_progress', 'completed'] as const;
export type GrnQcStatus = (typeof GRN_QC_STATUSES)[number];
