// AL-004 — SO upcoming delivery (next 7 days) (sales). Legacy line
// 22263-22264. Legacy operated at SO-header due_date; Phase 4 split
// due_date to per-line, so we return one record per line. Filter:
// line status = 'open' AND due_date BETWEEN today AND today + 7 days.

import { docNavPage } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { RegisteredAlert } from '../registry';

export const al004SoDue7Days: RegisteredAlert = {
  definition: {
    code: 'AL-004',
    dept: 'sales',
    name: 'SO Delivery Due in 7 Days',
    description: 'Open SO lines with a Due Date between today and 7 days from now.',
    columns: [
      // ADR-261 lead columns: SO No. · Internal SO No. · POL · Created On ·
      // Item Code (CODE/REV) · Item Name, then the rest.
      { key: 'so_code', label: 'SO No.', type: 'text' },
      { key: 'so_internal_no', label: 'Internal SO No.', type: 'text' },
      { key: 'client_po_line_no', label: 'POL', type: 'text' },
      { key: 'created_on', label: 'Created On', type: 'date' },
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_name', label: 'Item Name', type: 'text' },
      { key: 'line_no', label: 'Ln', type: 'number' },
      { key: 'customer', label: 'Customer', type: 'text' },
      { key: 'order_qty', label: 'Order Qty', type: 'number' },
      { key: 'due_date', label: 'Due Date', type: 'date' },
    ],
    defaultActive: true,
  },
  async run({ tx, companyId }) {
    const result = await tx.execute(sql`
      SELECT so.id AS nav_id,
             so.code AS so_code, so.internal_so_no AS so_internal_no,
             sol.client_po_line_no,
             (sol.created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS created_on,
             (COALESCE(i.code, sol.item_code_text, '')
               || COALESCE('/' || NULLIF(btrim(sol.revision::text), ''), '')) AS item_code,
             COALESCE(i.name, sol.part_name) AS item_name,
             sol.line_no,
             COALESCE(c.name, so.customer_name, '') AS customer,
             sol.order_qty, sol.due_date
      FROM public.sales_order_lines sol
      JOIN public.sales_orders so ON so.id = sol.sales_order_id
      LEFT JOIN public.clients c ON c.id = so.client_id
      LEFT JOIN public.items i ON i.id = sol.item_id
      WHERE sol.company_id = ${companyId}::uuid
        AND sol.deleted_at IS NULL
        AND so.deleted_at IS NULL
        AND sol.status = 'open'
        AND sol.due_date IS NOT NULL
        AND sol.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
      ORDER BY sol.due_date, so.code, sol.line_no
    `);
    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      navPage: docNavPage('sales-order', String(r['nav_id'])),
      so_code: (r['so_code'] as string | null) ?? '',
      so_internal_no: (r['so_internal_no'] as string | null) ?? '',
      client_po_line_no: (r['client_po_line_no'] as string | null) ?? '',
      created_on: String(r['created_on'] ?? ''),
      item_code: (r['item_code'] as string | null) ?? '',
      item_name: (r['item_name'] as string | null) ?? '',
      line_no: r['line_no'] != null ? Number(r['line_no']) : 0,
      customer: (r['customer'] as string) ?? '',
      order_qty: r['order_qty'] != null ? Number(r['order_qty']) : 0,
      due_date:
        r['due_date'] instanceof Date
          ? r['due_date'].toISOString().slice(0, 10)
          : String(r['due_date'] ?? ''),
    }));
    return { records: rows };
  },
};
