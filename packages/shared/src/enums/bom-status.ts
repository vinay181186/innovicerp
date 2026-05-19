// bom_masters.status — BOM lifecycle. Legacy renderBOMMaster L8444 maps
// these to badge colours: Active=green, Draft=amber, Obsolete=red.
//
//   draft     — WIP, not yet linkable from SOs
//   active    — available to link from Equipment-type SO lines
//   obsolete  — archived, kept for historical SO references
export const BOM_STATUSES = ['draft', 'active', 'obsolete'] as const;
export type BomStatus = (typeof BOM_STATUSES)[number];
