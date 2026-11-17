// bom_master_lines.bom_type — drives the BOM-to-SO cascade (BOM-8):
//   manufacture  → spawn a child JC for this sub-assembly
//   purchase     → spawn a PR for procurement of this component
//   outsource    → spawn a PR flagged for outsource workflow
//
//   party_supplied → ADR-307: the CUSTOMER sends it (child must be a Party
//                  Supplied Material `<code>-RM` item). No JC, no PR, no plan;
//                  received on a Party GRN against the Equipment SO.
//
// Mirrors legacy _bomMasterFormBody dropdown at L8536-8540.
export const BOM_LINE_TYPES = ['manufacture', 'purchase', 'outsource', 'party_supplied'] as const;
export type BomLineType = (typeof BOM_LINE_TYPES)[number];

// What a planner reads — on the BOM form's dropdown, and on the Excel Template's
// dropdown (apps/api/src/lib/excel-template.ts). "Buy" rather than "Purchase"
// because that is the word the rest of the app uses for the same decision
// (ITEM_PROCUREMENT_TYPE_LABEL.buy). The importer accepts the label or the
// stored code.
export const BOM_LINE_TYPE_LABEL: Record<BomLineType, string> = {
  manufacture: 'Manufacture',
  purchase: 'Buy',
  outsource: 'Outsource',
  party_supplied: 'Party Supplied',
};

/** ADR-307: the BOM line types we make or buy — everything except a
 *  customer-supplied part. Planning, the BOM cascade and PR raising use only these. */
export const isOwnSourcedBomLineType = (t: BomLineType): boolean => t !== 'party_supplied';

/** ADR-307: the Multi-Level BOM keeps the three own-sourced types — a
 *  customer-supplied part is handled on the single-level Equipment SO BOM only. */
export const ML_BOM_LINE_TYPES = ['manufacture', 'purchase', 'outsource'] as const;
export type MlBomLineType = (typeof ML_BOM_LINE_TYPES)[number];
