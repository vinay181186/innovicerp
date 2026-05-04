// Items master with on-hand stock — the master items list joined to
// v_item_stock so users can spot zero-stock items at a glance. Pattern:
// LEFT JOIN against a derived view (returns NULL on_hand for items with
// no store_transaction history → COALESCE to 0). Sortable by code; no
// filter. Highest-volume report — caps at 1000 rows.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';

export const itemsOnHandReport: RegisteredReport = {
  definition: {
    slug: 'items-on-hand',
    title: 'Items + on-hand stock',
    description:
      'Items master joined to `v_item_stock` for current on-hand qty. Items with no ledger history show 0. Useful for the daily stock-check.',
    group: 'Inventory',
    filters: [],
    columns: [
      { key: 'code', label: 'Item code', type: 'text' },
      { key: 'name', label: 'Item name', type: 'text' },
      { key: 'item_type', label: 'Type', type: 'text' },
      { key: 'uom', label: 'UOM', type: 'text' },
      { key: 'material', label: 'Material', type: 'text' },
      { key: 'on_hand_qty', label: 'On hand', type: 'number' },
    ],
  },
  async run({ tx, companyId }) {
    const result = await tx.execute(sql`
      SELECT
        i.code,
        i.name,
        i.item_type,
        i.uom,
        i.material,
        COALESCE(s.on_hand_qty, 0)::int AS on_hand_qty
      FROM public.items i
      LEFT JOIN public.v_item_stock s
        ON s.item_id = i.id AND s.company_id = i.company_id
      WHERE i.company_id = ${companyId}::uuid
        AND i.deleted_at IS NULL
      ORDER BY i.code
      LIMIT 1000
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      code: String(r['code'] ?? ''),
      name: String(r['name'] ?? ''),
      item_type: String(r['item_type'] ?? ''),
      uom: String(r['uom'] ?? ''),
      material: (r['material'] as string | null) ?? null,
      on_hand_qty: Number(r['on_hand_qty'] ?? 0),
    }));

    return { columns: itemsOnHandReport.definition.columns, rows };
  },
};
