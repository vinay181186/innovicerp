// Item Type — chosen when the item is created (owner decision Q2, ADR-193).
// Order = the order of the Item Master dropdown.
// `party_supplied_material` added by ADR-195: raw material the CLIENT supplies for
// a job-work (JWSO) order. It is job material like raw_material, but it is the
// customer's property — never purchased, never company-valued stock (its stock and
// value live in the zero-value party store, ADR-194). Its code carries an `-rm`
// suffix (e.g. ITM-0042-rm).
export const ITEM_TYPES = [
  'raw_material',
  'component',
  'assembly',
  'consumable',
  'tool',
  'party_supplied_material',
] as const;

export type ItemType = (typeof ITEM_TYPES)[number];

/** What each type means for the store (ADR-193). Screens and services read
 *  THIS map instead of repeating `if (type === '…')`, so a new type is one row
 *  here, not an edit on every screen.
 *   - jobMaterial:  issued against a Job Card as its raw material
 *   - bomParent:    can be the finished machine of a BOM / assembly SO
 *   - generalIssue: issued for general use (department, no job)
 *   - reorderable:  kept in stock by reorder level / reorder qty
 *   - returnable:   handed out and expected back (tool / instrument register)
 *   - partyOwned:   customer's property (ADR-195) — never purchased, never
 *                   company-valued stock; its stock/value live in the zero-value
 *                   party store (ADR-194). A `-rm`-suffixed code.
 *   - sold:         we invoice it to a customer (Component / Assembly). The
 *                   company "Check HSN" setting requires an HSN Code on these
 *                   types only (plan v3 D3, lib/master-rules.ts). */
export interface ItemTypeRule {
  label: string;
  jobMaterial: boolean;
  bomParent: boolean;
  generalIssue: boolean;
  reorderable: boolean;
  returnable: boolean;
  partyOwned: boolean;
  sold: boolean;
}

export const ITEM_TYPE_RULES: Record<ItemType, ItemTypeRule> = {
  raw_material: {
    label: 'Raw Material',
    jobMaterial: true,
    bomParent: false,
    generalIssue: false,
    reorderable: true,
    returnable: false,
    partyOwned: false,
    sold: false,
  },
  component: {
    label: 'Component',
    jobMaterial: true,
    bomParent: false,
    generalIssue: false,
    reorderable: true,
    returnable: false,
    partyOwned: false,
    sold: true,
  },
  assembly: {
    label: 'Assembly',
    jobMaterial: false,
    bomParent: true,
    generalIssue: false,
    reorderable: false,
    returnable: false,
    partyOwned: false,
    sold: true,
  },
  consumable: {
    label: 'Consumable',
    jobMaterial: false,
    bomParent: false,
    generalIssue: true,
    reorderable: true,
    returnable: false,
    partyOwned: false,
    sold: false,
  },
  tool: {
    label: 'Tool / Instrument',
    jobMaterial: false,
    bomParent: false,
    generalIssue: false,
    reorderable: true,
    returnable: true,
    partyOwned: false,
    sold: false,
  },
  party_supplied_material: {
    label: 'Party Supplied Material',
    // Job material (issued to a Job Card as its raw material) but the CUSTOMER's
    // property — so not reorderable and never company stock. The PO guard and the
    // stock writers read `partyOwned` to keep it off purchasing and company value.
    jobMaterial: true,
    bomParent: false,
    generalIssue: false,
    reorderable: false,
    returnable: false,
    partyOwned: true,
    sold: false,
  },
};

/** Screen word for a stored item-type code. */
export function itemTypeLabel(t: string): string {
  return (ITEM_TYPE_RULES as Record<string, ItemTypeRule>)[t]?.label ?? t;
}

/** ADR-195: a Party Supplied Material item's code carries this suffix, e.g.
 *  ITM-0042-rm. Case-insensitive; appended only once. Backend (item create/next
 *  code) and the item form both call this so the two never disagree. */
export const PARTY_MATERIAL_CODE_SUFFIX = '-rm';

export function withPartyMaterialSuffix(baseCode: string): string {
  const c = baseCode.trim();
  return c.toLowerCase().endsWith(PARTY_MATERIAL_CODE_SUFFIX) ? c : `${c}${PARTY_MATERIAL_CODE_SUFFIX}`;
}

/** True when a code is (or ends like) a Party Supplied Material code. */
export function isPartyMaterialCode(code: string): boolean {
  return code.trim().toLowerCase().endsWith(PARTY_MATERIAL_CODE_SUFFIX);
}
