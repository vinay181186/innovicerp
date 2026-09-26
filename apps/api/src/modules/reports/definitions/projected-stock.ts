// Projected stock & shortage — per item: Physical / Reserved / Available
// (v_item_stock_availability), plus what is still coming on open purchase
// orders and open Production Orders, against the item's Min Stock.
// Modelled on ERPNext's "Stock Projected Qty" report.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import { likeFilter } from './report-helpers';

export const projectedStockReport: RegisteredReport = {
  definition: {
    slug: 'projected-stock',
    title: 'Projected stock & shortage',
    description:
      'Per item: Physical, Reserved, Available, qty still due on open material POs (short-closed POs owe nothing) and on open Production Orders, the Projected total, and the Shortage against Min Stock.',
    group: 'Store',
    dept: 'store',
    filters: [
      { key: 'item', label: 'Item', kind: 'text', placeholder: 'Item code or name' },
      { key: 'onlyShort', label: 'Only Short', kind: 'enum', options: ['yes', 'no'] },
    ],
    columns: [
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_name', label: 'Item Name', type: 'text' },
      { key: 'physical_qty', label: 'Physical', type: 'number' },
      { key: 'reserved_qty', label: 'Reserved', type: 'number' },
      { key: 'available_qty', label: 'Available', type: 'number' },
      { key: 'on_po_qty', label: 'On Open PO', type: 'number' },
      { key: 'production_qty', label: 'Pending from Production', type: 'number' },
      { key: 'projected_qty', label: 'Projected', type: 'number' },
      { key: 'min_stock_qty', label: 'Min Stock', type: 'number' },
      { key: 'shortage_qty', label: 'Shortage', type: 'number' },
      { key: 'flag', label: 'Stock Flag', type: 'text' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const item = likeFilter(filters['item']);
    const onlyShort = filters['onlyShort'] === 'yes';
    const itemFrag = item ? sql`AND (i.code ILIKE ${item} OR i.name ILIKE ${item})` : sql``;
    const shortFrag = onlyShort ? sql`AND (x.shortage_qty > 0 OR x.projected_qty < 0)` : sql``;

    // Available = physical − reserved (v_item_stock_availability, 0141).
    // On Open PO: 'standard' POs only — job-work / service POs send our own
    // material out and back (stock-neutral, ADR-067), they add no stock.
    // Pending from Production: order_qty − credited − lost on orders still
    // open or partially closed (ADR-179 ledger columns).
    const result = await tx.execute(sql`
      SELECT
        x.item_code, x.item_name, x.physical_qty, x.reserved_qty, x.available_qty,
        x.on_po_qty, x.production_qty, x.projected_qty, x.min_stock_qty,
        GREATEST(0, x.min_stock_qty - x.projected_qty)::int AS shortage_qty,
        CASE
          WHEN x.projected_qty < 0 OR x.available_qty < 0 THEN 'Negative'
          WHEN x.min_stock_qty > 0 AND x.projected_qty < x.min_stock_qty THEN 'Below Min'
          ELSE ''
        END AS flag
      FROM (
        SELECT
          i.code                                    AS item_code,
          i.name                                    AS item_name,
          COALESCE(a.physical_qty, 0)::int          AS physical_qty,
          COALESCE(a.reserved_qty, 0)::int          AS reserved_qty,
          COALESCE(a.available_qty, 0)::int         AS available_qty,
          COALESCE(p.on_po_qty, 0)::int             AS on_po_qty,
          COALESCE(m.production_qty, 0)::int        AS production_qty,
          (COALESCE(a.available_qty, 0) + COALESCE(p.on_po_qty, 0)
            + COALESCE(m.production_qty, 0))::int   AS projected_qty,
          i.min_stock_qty                           AS min_stock_qty
        FROM public.items i
        LEFT JOIN public.v_item_stock_availability a
          ON a.item_id = i.id AND a.company_id = i.company_id
        LEFT JOIN (
          SELECT pol.item_id, SUM(GREATEST(0, pol.qty - pol.received_qty)) AS on_po_qty
          FROM public.purchase_order_lines pol
          JOIN public.purchase_orders po
            ON po.id = pol.purchase_order_id AND po.deleted_at IS NULL
          WHERE pol.company_id = ${companyId}::uuid
            AND pol.deleted_at IS NULL
            AND pol.item_id IS NOT NULL
            AND po.po_type = 'standard'
            AND po.status NOT IN ('draft', 'closed', 'cancelled')
            AND po.short_closed_at IS NULL
          GROUP BY pol.item_id
        ) p ON p.item_id = i.id
        LEFT JOIN (
          SELECT pro.item_id,
                 SUM(GREATEST(0, pro.order_qty - COALESCE(pro.credited_qty, 0)
                                 - COALESCE(pro.lost_qty, 0))) AS production_qty
          FROM public.production_orders pro
          WHERE pro.company_id = ${companyId}::uuid
            AND pro.deleted_at IS NULL
            AND pro.status IN ('open', 'partially_closed')
          GROUP BY pro.item_id
        ) m ON m.item_id = i.id
        WHERE i.company_id = ${companyId}::uuid
          AND i.deleted_at IS NULL
          ${itemFrag}
      ) x
      WHERE (x.physical_qty <> 0 OR x.reserved_qty <> 0 OR x.on_po_qty <> 0
             OR x.production_qty <> 0 OR x.min_stock_qty > 0)
        ${shortFrag}
      ORDER BY (x.min_stock_qty - x.projected_qty) DESC, x.item_code
      LIMIT 2000
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      item_code: String(r['item_code'] ?? ''),
      item_name: String(r['item_name'] ?? ''),
      physical_qty: Number(r['physical_qty'] ?? 0),
      reserved_qty: Number(r['reserved_qty'] ?? 0),
      available_qty: Number(r['available_qty'] ?? 0),
      on_po_qty: Number(r['on_po_qty'] ?? 0),
      production_qty: Number(r['production_qty'] ?? 0),
      projected_qty: Number(r['projected_qty'] ?? 0),
      min_stock_qty: Number(r['min_stock_qty'] ?? 0),
      shortage_qty: Number(r['shortage_qty'] ?? 0),
      flag: String(r['flag'] ?? ''),
    }));

    return { columns: projectedStockReport.definition.columns, rows };
  },
};
