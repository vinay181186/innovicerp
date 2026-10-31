// AL-011 — BOM not prepared (design). Legacy line 22277-22278.
// Filter: SO type = 'equipment' AND bom_status = 'pending'.
// Note: bom_status is a free-text column on sales_orders. Legacy values
// observed: 'BOM Pending', 'BOM Ready'. We match case-insensitively
// against patterns containing "pending" to absorb legacy capitalisation
// drift without forcing a normalisation pass on existing data.

import { docNavPage } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { RegisteredAlert } from '../registry';

export const al011BomPending: RegisteredAlert = {
  definition: {
    code: 'AL-011',
    dept: 'design',
    name: 'BOM Not Prepared',
    description: 'Equipment SOs whose BOM Status shows the BOM is not ready yet.',
    columns: [
      // ADR-261 lead columns an SO header has (no line: no POL / item).
      { key: 'so_code', label: 'SO No.', type: 'text' },
      { key: 'so_internal_no', label: 'Internal SO No.', type: 'text' },
      { key: 'created_on', label: 'Created On', type: 'date' },
      { key: 'customer', label: 'Customer', type: 'text' },
      { key: 'bom_status', label: 'BOM Status', type: 'text' },
      { key: 'so_date', label: 'SO Date', type: 'date' },
    ],
    defaultActive: true,
  },
  async run({ tx, companyId }) {
    const result = await tx.execute(sql`
      SELECT so.id AS nav_id,
             so.code AS so_code, so.internal_so_no AS so_internal_no,
             (so.created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS created_on,
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
      navPage: docNavPage('sales-order', String(r['nav_id'])),
      so_code: (r['so_code'] as string) ?? '',
      so_internal_no: (r['so_internal_no'] as string | null) ?? '',
      created_on: String(r['created_on'] ?? ''),
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
