// Item Tracker — cross-cutting "where is each item right now" rollup.
// Ports the summary mode of legacy `_rptItemWhere` (HTML L20447–20472).
//
// Per item: in_stock (from v_item_stock) + in_production (Σ order_qty of
// open job cards for the item) + in_po_ordered (Σ open PO-line qty minus
// received GRN qty). Total column = sum of the three.
//
// At-vendor qty (JW DC outward / inward) is deferred — those tables haven't
// been ported to this codebase yet. The legacy spec includes a 5th column;
// here we ship the 4-column subset until JW DCs land.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';

export const itemTrackerReport: RegisteredReport = {
  definition: {
    slug: 'item-tracker',
    title: 'Item Tracker',
    description:
      'Per-item rollup of current location: in stock, in production (open JCs), and pending on open POs. Drives the sales-planner question "where is this item right now?".',
    group: 'Sales',
    filters: [],
    columns: [
      { key: 'item_code', label: 'Item', type: 'text' },
      { key: 'item_name', label: 'Name', type: 'text' },
      { key: 'in_stock', label: 'In Stock', type: 'number' },
      { key: 'in_production', label: 'In Production', type: 'number' },
      { key: 'in_po_ordered', label: 'In PO (Ordered)', type: 'number' },
      { key: 'total', label: 'Total', type: 'number' },
    ],
  },
  async run({ tx, companyId }) {
    const result = await tx.execute(sql`
      WITH jc_open AS (
        SELECT
          jc.item_id,
          SUM(jc.order_qty)::int AS qty
        FROM public.job_cards jc
        LEFT JOIN public.v_jc_status v ON v.job_card_id = jc.id
        WHERE jc.company_id = ${companyId}::uuid
          AND jc.deleted_at IS NULL
          AND (v.computed_status IS NULL OR v.computed_status NOT IN ('complete', 'closed'))
        GROUP BY jc.item_id
      ),
      po_pending AS (
        SELECT
          pol.item_id,
          SUM(GREATEST(0, pol.qty - COALESCE(grn_agg.received, 0)))::int AS qty
        FROM public.purchase_order_lines pol
        JOIN public.purchase_orders po ON po.id = pol.purchase_order_id
        LEFT JOIN (
          SELECT
            grnl.purchase_order_line_id AS po_line_id,
            SUM(grnl.received_qty) AS received
          FROM public.goods_receipt_note_lines grnl
          JOIN public.goods_receipt_notes grn ON grn.id = grnl.goods_receipt_note_id
          WHERE grn.company_id = ${companyId}::uuid
            AND grn.deleted_at IS NULL
            AND grnl.deleted_at IS NULL
          GROUP BY grnl.purchase_order_line_id
        ) grn_agg ON grn_agg.po_line_id = pol.id
        WHERE pol.company_id = ${companyId}::uuid
          AND po.company_id = ${companyId}::uuid
          AND pol.deleted_at IS NULL
          AND po.deleted_at IS NULL
          AND po.status <> 'closed'
          AND pol.item_id IS NOT NULL
        GROUP BY pol.item_id
      )
      SELECT
        i.code                                     AS item_code,
        i.name                                     AS item_name,
        COALESCE(s.on_hand_qty, 0)::int            AS in_stock,
        COALESCE(jc_open.qty, 0)::int              AS in_production,
        COALESCE(po_pending.qty, 0)::int           AS in_po_ordered,
        (
          COALESCE(s.on_hand_qty, 0) +
          COALESCE(jc_open.qty, 0) +
          COALESCE(po_pending.qty, 0)
        )::int                                     AS total
      FROM public.items i
      LEFT JOIN public.v_item_stock s
        ON s.item_id = i.id AND s.company_id = i.company_id
      LEFT JOIN jc_open ON jc_open.item_id = i.id
      LEFT JOIN po_pending ON po_pending.item_id = i.id
      WHERE i.company_id = ${companyId}::uuid
        AND i.deleted_at IS NULL
      ORDER BY i.code
      LIMIT 1000
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      item_code: String(r['item_code'] ?? ''),
      item_name: String(r['item_name'] ?? ''),
      in_stock: Number(r['in_stock'] ?? 0),
      in_production: Number(r['in_production'] ?? 0),
      in_po_ordered: Number(r['in_po_ordered'] ?? 0),
      total: Number(r['total'] ?? 0),
    }));

    return { columns: itemTrackerReport.definition.columns, rows };
  },
};
