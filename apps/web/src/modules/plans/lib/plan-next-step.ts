// Where a route-card plan's next step lives — ONE copy of these links, shared
// by the Plans list ⋯ and the SO Planning ⋯ (line menu + each BOM child row).
//
//   route_card_pending   → Create Route Card (one card per ITEM, reused by
//                          every plan for that item — so it carries the item,
//                          not the plan; the server refuses a second card)
//   gen_production_order → Create Production Order (carries the plan; the
//                          server caps it at the plan's Pending under a lock)

/** `path?a=1&b=2`, leaving out the empty values. */
export function withQuery(path: string, params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const qs = q.toString();
  return qs ? `${path}?${qs}` : path;
}

/** New Route Card screen, item pre-filled. Live code/name over the snapshot. */
export function newRouteCardTo(plan: {
  itemId: string | null;
  itemCode?: string | null;
  itemCodeText?: string | null;
  itemName?: string | null;
  itemNameText?: string | null;
}): string {
  return withQuery('/route-cards/new', {
    itemId: plan.itemId,
    itemCode: plan.itemCode ?? plan.itemCodeText,
    itemName: plan.itemName ?? plan.itemNameText,
  });
}

/** New Production Order screen, plan pre-selected. */
export function newProductionOrderTo(plan: { id: string; code: string }): string {
  return withQuery('/production-orders/new', { planId: plan.id, planCode: plan.code });
}
