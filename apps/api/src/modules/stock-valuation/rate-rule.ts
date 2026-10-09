// An item's bought rate — the ONE rule (Stock Valuation, ADR-189):
//
//   the PO line rate behind the item's latest GRN (non-draft, non-cancelled
//   PO), else the item's latest non-draft, non-cancelled PO line rate, else
//   no rate.
//
// Two CTEs, `last_grn_rate` and `last_po_rate`, keyed by item_id. Stock
// Valuation reads them with no options and gets the exact SQL it always ran;
// the Multi-Level BOM cost estimate (ADR-225 phase 6) asks for the GRN / PO
// code as well and narrows the items, so both screens quote one rate.
//
// The SQL text below is laid out for its place inside Stock Valuation's query
// (10-space indent) — keep it that way so that query renders unchanged.

import { type SQL, sql } from 'drizzle-orm';

export interface ItemRateCteOptions {
  /** Also select `grn_code` + `po_code` (last_grn_rate) and `po_code`
   *  (last_po_rate) — the document the rate came from. */
  withRefs?: boolean;
  /** Only these items: a SELECT returning one uuid column. */
  itemIdIn?: SQL;
}

/** `last_grn_rate AS (…), last_po_rate AS (…)` — put after `WITH`. `cid` is a
 *  SQL fragment that evaluates to the company uuid. */
export function itemRateCtes(cid: SQL, opts: ItemRateCteOptions = {}): SQL {
  const grnRefs = opts.withRefs ? sql`, g.code AS grn_code, gpo.code AS po_code` : sql``;
  const poRefs = opts.withRefs ? sql`, po.code AS po_code` : sql``;
  const grnItems = opts.itemIdIn
    ? sql`
            AND gl.item_id IN (${opts.itemIdIn})`
    : sql``;
  const poItems = opts.itemIdIn
    ? sql`
            AND pol.item_id IN (${opts.itemIdIn})`
    : sql``;
  return sql`last_grn_rate AS (
          SELECT DISTINCT ON (gl.item_id)
            gl.item_id, pol.rate, g.grn_date${grnRefs}
          FROM goods_receipt_note_lines gl
          JOIN goods_receipt_notes g ON g.id = gl.goods_receipt_note_id
          JOIN purchase_order_lines pol ON pol.id = gl.purchase_order_line_id
          JOIN purchase_orders gpo ON gpo.id = pol.purchase_order_id
          WHERE g.company_id = ${cid} AND g.deleted_at IS NULL AND gl.deleted_at IS NULL
            AND gl.item_id IS NOT NULL AND pol.rate > 0
            AND gpo.status NOT IN ('draft', 'cancelled')${grnItems}
          ORDER BY gl.item_id, g.grn_date DESC, g.created_at DESC
        ),
        last_po_rate AS (
          SELECT DISTINCT ON (pol.item_id) pol.item_id, pol.rate${poRefs}
          FROM purchase_order_lines pol
          JOIN purchase_orders po ON po.id = pol.purchase_order_id
          WHERE po.company_id = ${cid} AND po.deleted_at IS NULL
            AND pol.item_id IS NOT NULL AND pol.rate > 0
            -- ADR-189 — a draft or cancelled PO is not a price anybody paid.
            AND po.status NOT IN ('draft', 'cancelled')${poItems}
          ORDER BY pol.item_id, po.po_date DESC
        )`;
}
