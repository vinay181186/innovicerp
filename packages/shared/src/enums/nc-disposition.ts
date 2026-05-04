// nc_register.disposition — chosen action when the QC team disposes a
// non-conformance. Five values from legacy `_disposeNC` modal options
// (~line 22633). Nullable on the row until disposition is picked.
export const NC_DISPOSITIONS = [
  'rework',
  'scrap',
  'use_as_is',
  'return_to_vendor',
  'make_fresh',
] as const;
export type NcDisposition = (typeof NC_DISPOSITIONS)[number];
