// How an item is normally sourced — the ERP-standard "make or buy" flag
// (SAP Material Master procurement type E = in-house / F = external; Odoo
// product routes Manufacture / Buy). Column `items.procurement_type`,
// migration 0134, ADR-171.
//
//   make — we produce it: Planning → Plan → Production Order → Route Card →
//          Job Card (also covers full-outsource routes).
//   buy  — we purchase it finished: Planning → "+ PR" on the SO line →
//          PR → PO → GRN → stock. No plan, no route card, no Production Order.
export const ITEM_PROCUREMENT_TYPES = ['make', 'buy'] as const;
export type ItemProcurementType = (typeof ITEM_PROCUREMENT_TYPES)[number];

export const ITEM_PROCUREMENT_TYPE_LABEL: Record<ItemProcurementType, string> = {
  make: 'Make',
  buy: 'Buy',
};
