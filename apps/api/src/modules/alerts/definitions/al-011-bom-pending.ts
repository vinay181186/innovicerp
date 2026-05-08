// AL-011 — BOM not prepared (design). Legacy line 22277-22278.
// Filter: SO type = 'equipment' AND bom_status = 'pending'.
// Note: bom_status is a free-text column on sales_orders. Legacy values
// observed: 'BOM Pending', 'BOM Ready'. We match case-insensitively
// against patterns containing "pending" to absorb legacy capitalisation
// drift without forcing a normalisation pass on existing data.

import { sql } from 'drizzle-orm';
import type { RegisteredAlert } from '../registry';

export const al011BomPending: RegisteredAlert = {
  definition: {
    code: 'AL-011',
    dept: 'design',
    name: 'BOM not prepared',
    description:
      'Equipment-type SOs whose bom_status indicates the bill of materials has not been finalised.',
    columns: [
      { key: 'so_code', label: 'SO no.', type: 'text' },
      { key: 'customer', label: 'Customer', type: 'text' },
      { key: 'bom_status', label: 'BOM status', type: 'text' },
      { key: 'so_date', label: 'SO date', type: 'date' },
    ],
    defaultActive: true,
  },
  async run({ tx, companyId }) {
    const result = await tx.execute(sql`
      SELECT so.code AS so_code,
             COALESCE(c.name, so.customer_name, '') AS customer,
             COALESCE(so.bom_status, '') AS bom_status, so.so_date
      FROM public.sales_orders so
      LEFT JOIN public.clients c ON c.id = so.client_id
      WHERE so.company_id = ${companyId}::uuid
        AND so.deleted_at IS NULL
        AND so.type = 'equipment'
        AND so.bom_status IS NOT NULL
        AND so.bom_status ILIKE '%pending%'
      ORDER BY so.so_date, so.code
    `);
    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      so_code: (r['so_code'] as string) ?? '',
      customer: (r['customer'] as string) ?? '',
      bom_status: (r['bom_status'] as string) ?? '',
      so_date:
        r['so_date'] instanceof Date
          ? r['so_date'].toISOString().slice(0, 10)
          : String(r['so_date'] ?? ''),
    }));
    return { records: rows };
  },
};
