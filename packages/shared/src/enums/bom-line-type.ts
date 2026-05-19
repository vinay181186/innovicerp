// bom_master_lines.bom_type — drives the BOM-to-SO cascade (BOM-8):
//   manufacture  → spawn a child JC for this sub-assembly
//   purchase     → spawn a PR for procurement of this component
//   outsource    → spawn a PR flagged for outsource workflow
//
// Mirrors legacy _bomMasterFormBody dropdown at L8536-8540.
export const BOM_LINE_TYPES = ['manufacture', 'purchase', 'outsource'] as const;
export type BomLineType = (typeof BOM_LINE_TYPES)[number];
