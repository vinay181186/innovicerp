// AL-005 — Overdue SO delivery (sales). Legacy line 22265-22266.
// Same shape as AL-004 but due_date < today.

import { sql } from 'drizzle-orm';
import type { RegisteredAlert } from '../registry';

export const al005SoOverdue: RegisteredAlert = {
  definition: {
    code: 'AL-005',
    dept: 'sales',
    name: 'Overdue SO delivery',
    description: 'Open SO lines with due_date in the past.',
    columns: [
      { key: 'so_code', label: 'SO no.', type: 'text' },
      { key: 'line_no', label: 'Line', type: 'number' },
      { key: 'customer', label: 'Customer', type: 'text' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'order_qty', label: 'Qty', type: 'number' },
      { key: 'due_date', label: 'Due', type: 'date' },
    ],
    defaultActive: true,
  },
  async run({ tx, companyId }) {
    const result = await tx.execute(sql`
      SELECT so.code AS so_code, sol.line_no,
             COALESCE(c.name, so.customer_name, '') AS customer,
             COALESCE(i.code, sol.item_code_text, '') AS item,
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
        AND sol.due_date < CURRENT_DATE
      ORDER BY sol.due_date, so.code, sol.line_no
    `);
    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      so_code: (r['so_code'] as string) ?? '',
      line_no: r['line_no'] != null ? Number(r['line_no']) : 0,
      customer: (r['customer'] as string) ?? '',
      item: (r['item'] as string) ?? '',
      order_qty: r['order_qty'] != null ? Number(r['order_qty']) : 0,
      due_date:
        r['due_date'] instanceof Date
          ? r['due_date'].toISOString().slice(0, 10)
          : String(r['due_date'] ?? ''),
    }));
    return { records: rows };
  },
};
