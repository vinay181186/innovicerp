// nc_register.reason_category — defect class. Seven values from legacy
// `_addManualNC` modal (~line 22584). Defaults to `other` because legacy
// auto-create path leaves the field blank until disposition picks one.
export const NC_REASON_CATEGORIES = [
  'dimensional',
  'surface',
  'material',
  'process',
  'operator_error',
  'machine_fault',
  'other',
] as const;
export type NcReasonCategory = (typeof NC_REASON_CATEGORIES)[number];
