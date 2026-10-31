// AL-012 — Overdue JCs (production). Legacy line 22279-22280.
// Filter: due_date < today AND derived status NOT IN ('complete',
// 'closed'). Joins v_jc_status because job_cards has no status column
// per ADR-011 #2.

import { docNavPage } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { polSql } from '../../../lib/pol';
import type { RegisteredAlert } from '../registry';

export const al012JcOverdue: RegisteredAlert = {
  definition: {
    code: 'AL-012',
    dept: 'production',
    name: 'Overdue JCs',
    description: 'JCs past their Due Date whose JC Status is not Completed or Closed.',
    columns: [
      // ADR-261 lead columns: SO No. · Internal SO No. · POL · Created On ·
      // Item Code (CODE/REV) · Item Name, then the rest.
      { key: 'so_code', label: 'SO No.', type: 'text' },
      { key: 'so_internal_no', label: 'Internal SO No.', type: 'text' },
      { key: 'client_po_line_no', label: 'POL', type: 'text' },
      { key: 'created_on', label: 'Created On', type: 'date' },
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_name', label: 'Item Name', type: 'text' },
      { key: 'jc_code', label: 'JC No.', type: 'text' },
      { key: 'order_qty', label: 'Order Qty', type: 'number' },
      { key: 'due_date', label: 'Due Date', type: 'date' },
      { key: 'computed_status', label: 'JC Status', type: 'text' },
    ],
    defaultActive: true,
  },
  async run({ tx, companyId }) {
    const result = await tx.execute(sql`
      SELECT jc.id AS nav_id,
             COALESCE(so.code, jwo.code) AS so_code, so.internal_so_no AS so_internal_no,
             ${polSql('sol', 'jwl')} AS client_po_line_no,
             (jc.created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS created_on,
             (i.code || COALESCE('/' || NULLIF(btrim(COALESCE(sol.revision::text, jwl.revision::text)), ''), '')) AS item_code,
             i.name AS item_name,
             jc.code AS jc_code, jc.order_qty, jc.due_date,
             COALESCE(s.computed_status, 'no_ops') AS computed_status
      FROM public.job_cards jc
      JOIN public.items i ON i.id = jc.item_id
      LEFT JOIN public.v_jc_status s ON s.job_card_id = jc.id
      LEFT JOIN public.sales_order_lines sol ON sol.id = jc.source_so_line_id
      LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id
      LEFT JOIN public.job_work_order_lines jwl ON jwl.id = jc.source_jw_line_id
      LEFT JOIN public.job_work_orders jwo ON jwo.id = jwl.job_work_order_id
      WHERE jc.company_id = ${companyId}::uuid
        AND jc.deleted_at IS NULL
        AND jc.due_date IS NOT NULL
        AND jc.due_date < CURRENT_DATE
        AND COALESCE(s.computed_status, 'no_ops') NOT IN ('complete', 'closed')
      ORDER BY jc.due_date, jc.code
    `);
    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      navPage: docNavPage('job-card', String(r['nav_id'])),
      so_code: (r['so_code'] as string | null) ?? '',
      so_internal_no: (r['so_internal_no'] as string | null) ?? '',
      client_po_line_no: (r['client_po_line_no'] as string | null) ?? '',
      created_on: String(r['created_on'] ?? ''),
      item_code: (r['item_code'] as string | null) ?? '',
      item_name: (r['item_name'] as string | null) ?? '',
      jc_code: (r['jc_code'] as string) ?? '',
      order_qty: r['order_qty'] != null ? Number(r['order_qty']) : 0,
      due_date:
        r['due_date'] instanceof Date
          ? r['due_date'].toISOString().slice(0, 10)
          : String(r['due_date'] ?? ''),
      computed_status: (r['computed_status'] as string) ?? '',
    }));
    return { records: rows };
  },
};
