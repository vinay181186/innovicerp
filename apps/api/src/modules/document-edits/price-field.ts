// Which edit-approval boxes are PRICES ("Can See Price"). One explicit list, read
// by the two places that act on it: the inbox masking (./helpers.ts
// maskPriceChanges) and the approve refusal for a price-blind approver
// (./service.ts decideDocumentEdit). Pure: no database, no access.
//
// Deliberately narrow — real per-unit prices only. GST %, GSTIN, payment days,
// cost-centre names and the like are NOT prices here. (History keeps its own,
// broader rule in activity-log/history.ts; this list does not change it.)

/** The price attributes: PO line Rate, Plan Unit Cost / Rate, Machine Hour
 *  Rate, PR Est. Rate, Job Card operation outsource cost. */
const PRICE_ATTRS: ReadonlySet<string> = new Set([
  'rate',
  'dpCost',
  'foRate',
  'hourRate',
  'estCost',
  'outsourceCost',
]);

/** Is this change key a price? Judged by its attribute part, so `line:<id>:rate`
 *  and `op:<id>:outsourceCost` count, as do plain keys like `dpCost`. */
export function isPriceField(field: string): boolean {
  return PRICE_ATTRS.has(field.slice(field.lastIndexOf(':') + 1));
}
