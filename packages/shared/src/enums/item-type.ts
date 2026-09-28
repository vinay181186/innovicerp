// Item Type — chosen when the item is created (owner decision Q2, ADR-193).
// Order = the order of the Item Master dropdown.
export const ITEM_TYPES = ['raw_material', 'component', 'assembly', 'consumable', 'tool'] as const;

export type ItemType = (typeof ITEM_TYPES)[number];

/** What each type means for the store (ADR-193). Screens and services read
 *  THIS map instead of repeating `if (type === '…')`, so a new type is one row
 *  here, not an edit on every screen.
 *   - jobMaterial:  issued against a Job Card as its raw material
 *   - bomParent:    can be the finished machine of a BOM / assembly SO
 *   - generalIssue: issued for general use (department, no job)
 *   - reorderable:  kept in stock by reorder level / reorder qty
 *   - returnable:   handed out and expected back (tool / instrument register) */
export interface ItemTypeRule {
  label: string;
  jobMaterial: boolean;
  bomParent: boolean;
  generalIssue: boolean;
  reorderable: boolean;
  returnable: boolean;
}

export const ITEM_TYPE_RULES: Record<ItemType, ItemTypeRule> = {
  raw_material: {
    label: 'Raw Material',
    jobMaterial: true,
    bomParent: false,
    generalIssue: false,
    reorderable: true,
    returnable: false,
  },
  component: {
    label: 'Component',
    jobMaterial: true,
    bomParent: false,
    generalIssue: false,
    reorderable: true,
    returnable: false,
  },
  assembly: {
    label: 'Assembly',
    jobMaterial: false,
    bomParent: true,
    generalIssue: false,
    reorderable: false,
    returnable: false,
  },
  consumable: {
    label: 'Consumable',
    jobMaterial: false,
    bomParent: false,
    generalIssue: true,
    reorderable: true,
    returnable: false,
  },
  tool: {
    label: 'Tool / Instrument',
    jobMaterial: false,
    bomParent: false,
    generalIssue: false,
    reorderable: false,
    returnable: true,
  },
};

/** Screen word for a stored item-type code. */
export function itemTypeLabel(t: string): string {
  return (ITEM_TYPE_RULES as Record<string, ItemTypeRule>)[t]?.label ?? t;
}
