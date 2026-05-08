// AL-003 — Items out of stock (store). Legacy line 22261-22262 used
// `n(i.stockQty)<=0` against the legacy denormalised items.stockQty
// column. Our schema derives stock from v_item_stock per ADR-015 #11
// (no items.stock_qty column to avoid drift — exactly the anti-pattern
// Phase 1 was meant to escape).

import { sql } from 'drizzle-orm';
import type { RegisteredAlert } from '../registry';

export const al003ItemsOutOfStock: RegisteredAlert = {
  definition: {
    code: 'AL-003',
    dept: 'store',
    name: 'Items out of stock',
    description:
      'Items where the derived on-hand qty (from v_item_stock aggregating store_transactions) is <= 0.',
    columns: [
      { key: 'item_code', label: 'Item code', type: 'text' },
      { key: 'item_name', label: 'Item name', type: 'text' },
      { key: 'on_hand_qty', label: 'On hand', type: 'number' },
      { key: 'material', label: 'Material', type: 'text' },
    ],
    defaultActive: true,
  },
  async run({ tx, companyId }) {
    const result = await tx.execute(sql`
      SELECT i.code AS item_code, i.name AS item_name,
             COALESCE(s.on_hand_qty, 0) AS on_hand_qty,
             COALESCE(i.material, '') AS material
      FROM public.items i
      LEFT JOIN public.v_item_stock s
        ON s.item_id = i.id AND s.company_id = i.company_id
      WHERE i.company_id = ${companyId}::uuid
        AND i.deleted_at IS NULL
        AND COALESCE(s.on_hand_qty, 0) <= 0
      ORDER BY i.code
    `);
    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      item_code: (r['item_code'] as string) ?? '',
      item_name: (r['item_name'] as string) ?? '',
      on_hand_qty: r['on_hand_qty'] != null ? Number(r['on_hand_qty']) : 0,
      material: (r['material'] as string) ?? '',
    }));
    return { records: rows };
  },
};
