// nc_register lifecycle status. Sourced from legacy `renderNCRegister` filter
// dropdown (Pending / Disposed / Rework Complete / Closed) + `_disposeNC`
// transitions in legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html
// (~line 22555 + ~22650). `rework_done` matches the legacy `Rework Done`
// transitional state used between disposition and final close.
export const NC_STATUSES = ['pending', 'disposed', 'rework_done', 'closed'] as const;
export type NcStatus = (typeof NC_STATUSES)[number];
