// nc_register.disposition — chosen action when the QC team disposes a
// non-conformance. Five values from legacy `_disposeNC` modal options
// (~line 22633). Nullable on the row until disposition is picked.
//
// 2026-09-12 (QC–NC handling, docs/QC-NC-HANDLING-DESIGN.md §1): `repair` added.
// `rework` and `repair` now each raise a CHILD job card for the rejected
// pieces; `scrap` is the document's "Reject". `use_as_is` and `make_fresh` are
// kept as they were.
export const NC_DISPOSITIONS = [
  'rework',
  'repair',
  'scrap',
  'use_as_is',
  'return_to_vendor',
  'make_fresh',
] as const;

/** The dispositions that raise a child recovery Job Card (design §4). */
export const NC_RECOVERY_DISPOSITIONS = ['rework', 'repair'] as const;
export type NcRecoveryDisposition = (typeof NC_RECOVERY_DISPOSITIONS)[number];
export type NcDisposition = (typeof NC_DISPOSITIONS)[number];
