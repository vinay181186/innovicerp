// delivery_challans.status — DC lifecycle. Only `issued` is exhibited in
// legacy data; `received` and `cancelled` are reserved forward states for
// the future inward-DC + cancellation flows (legacy `jwDCInward` collection
// is doc_missing in the export, so we cannot drive `received` from migration).
export const DC_STATUSES = ['issued', 'received', 'cancelled'] as const;
export type DcStatus = (typeof DC_STATUSES)[number];
