// AL-007 — Today's GRN (store). Legacy line 22269-22270.
// Filter: grn_date = today.

import { sql } from 'drizzle-orm';
import type { RegisteredAlert } from '../registry';

export const al007GrnToday: RegisteredAlert = {
  definition: {
    code: 'AL-007',
    dept: 'store',
    name: "Today's GRN",
    description: 'Goods receipt notes recorded today.',
    columns: [
      { key: 'grn_code', label: 'GRN no.', type: 'text' },
      { key: 'grn_date', label: 'Date', type: 'date' },
      { key: 'vendor', label: 'Vendor', type: 'text' },
      { key: 'po_code', label: 'PO no.', type: 'text' },
    ],
    defaultActive: true,
  },
  async run({ tx, companyId }) {
    const result = await tx.execute(sql`
      SELECT g.code AS grn_code, g.grn_date,
             COALESCE(v.code, g.vendor_code_text, '') AS vendor,
             COALESCE(po.code, g.po_code_text, '') AS po_code
      FROM public.goods_receipt_notes g
      LEFT JOIN public.vendors v ON v.id = g.vendor_id
      LEFT JOIN public.purchase_orders po ON po.id = g.purchase_order_id
      WHERE g.company_id = ${companyId}::uuid
        AND g.deleted_at IS NULL
        AND g.grn_date = CURRENT_DATE
      ORDER BY g.code
    `);
    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      grn_code: (r['grn_code'] as string) ?? '',
      grn_date:
        r['grn_date'] instanceof Date
          ? r['grn_date'].toISOString().slice(0, 10)
          : String(r['grn_date'] ?? ''),
      vendor: (r['vendor'] as string) ?? '',
      po_code: (r['po_code'] as string) ?? '',
    }));
    return { records: rows };
  },
};
