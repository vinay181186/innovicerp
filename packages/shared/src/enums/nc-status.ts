// nc_register lifecycle status. Sourced from legacy `renderNCRegister` filter
// dropdown (Pending / Disposed / Rework Complete / Closed) + `_disposeNC`
// transitions in legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html
// (~line 22555 + ~22650). `rework_done` matches the legacy `Rework Done`
// transitional state used between disposition and final close.
//
// 2026-09-12 (QC–NC handling, docs/QC-NC-HANDLING-DESIGN.md §2): four
// locations an NC qty can be in while its recovery is under way. `disposed`
// now means "return-to-vendor chosen, challan not yet issued" on new rows,
// and keeps its old generic meaning on legacy in-route rework rows.
export const NC_STATUSES = [
  'pending',
  'disposed',
  'under_rework',
  'under_repair',
  'sent_to_vendor',
  'received_qc_pending',
  'rework_done',
  'closed',
] as const;
export type NcStatus = (typeof NC_STATUSES)[number];
