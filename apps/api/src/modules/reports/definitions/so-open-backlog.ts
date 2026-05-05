// SO open backlog — open SO lines with pending qty + value, sorted by due
// date so the next-up sales work surfaces. Pattern: list with computed
// fields (pending_qty, line_value), date-range filter, joins
// sales_order_lines → sales_orders → items → clients → v_jc_status.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';

export const soOpenBacklogReport: RegisteredReport = {
  definition: {
    slug: 'so-open-backlog',
    title: 'SO open backlog',
    description:
      'Open SO lines with pending qty (order_qty - completed JC qty) and line value. Filter by SO type or due-date window; sorted by due date ascending.',
    group: 'Sales',
    filters: [
      { key: 'fromDueDate', label: 'Due from', kind: 'date' },
      { key: 'toDueDate', label: 'Due to', kind: 'date' },
      {
        key: 'soType',
        label: 'SO Type',
        kind: 'enum',
        options: ['standard', 'job_work'],
      },
    ],
    columns: [
      { key: 'so_code', label: 'SO no.', type: 'text' },
      { key: 'so_date', label: 'SO date', type: 'date' },
      { key: 'client_name', label: 'Client', type: 'text' },
      { key: 'so_type', label: 'Type', type: 'text' },
      { key: 'line_no', label: 'Line', type: 'number' },
      { key: 'item_code', label: 'Item code', type: 'text' },
      { key: 'item_name', label: 'Item name', type: 'text' },
      { key: 'order_qty', label: 'Order qty', type: 'number' },
      { key: 'completed_qty', label: 'Completed qty', type: 'number' },
      { key: 'pending_qty', label: 'Pending qty', type: 'number' },
      { key: 'line_value', label: 'Line value', type: 'number' },
      { key: 'due_date', label: 'Due date', type: 'date' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const fromDate = filters['fromDueDate'];
    const toDate = filters['toDueDate'];
    const soType = filters['soType'];
    const validTypes = ['standard', 'job_work'];

    const fromFrag = fromDate ? sql`AND sol.due_date >= ${fromDate}::date` : sql``;
    const toFrag = toDate ? sql`AND sol.due_date <= ${toDate}::date` : sql``;
    const typeFrag =
      soType && validTypes.includes(soType) ? sql`AND so.type = ${soType}::so_type` : sql``;

    const result = await tx.execute(sql`
      SELECT
        so.code                                  AS so_code,
        so.so_date                               AS so_date,
        COALESCE(cl.name, so.customer_name, '—') AS client_name,
        so.type::text                            AS so_type,
        sol.line_no                              AS line_no,
        COALESCE(it.code, sol.item_code_text, '—') AS item_code,
        COALESCE(it.name, sol.part_name)         AS item_name,
        sol.order_qty                            AS order_qty,
        COALESCE((
          SELECT SUM(GREATEST(0, jc.order_qty))
          FROM public.job_cards jc
          LEFT JOIN public.v_jc_status v ON v.job_card_id = jc.id
          WHERE jc.source_so_line_id = sol.id
            AND jc.deleted_at IS NULL
            AND v.computed_status IN ('complete', 'closed')
        ), 0)::int                               AS completed_qty,
        GREATEST(
          0,
          sol.order_qty - COALESCE((
            SELECT SUM(GREATEST(0, jc.order_qty))
            FROM public.job_cards jc
            LEFT JOIN public.v_jc_status v ON v.job_card_id = jc.id
            WHERE jc.source_so_line_id = sol.id
              AND jc.deleted_at IS NULL
              AND v.computed_status IN ('complete', 'closed')
          ), 0)
        )::int                                   AS pending_qty,
        (sol.order_qty * sol.rate)::numeric(14, 2) AS line_value,
        sol.due_date                             AS due_date
      FROM public.sales_order_lines sol
      JOIN public.sales_orders so ON so.id = sol.sales_order_id
      LEFT JOIN public.items it ON it.id = sol.item_id
      LEFT JOIN public.clients cl ON cl.id = so.client_id
      WHERE sol.company_id = ${companyId}::uuid
        AND sol.deleted_at IS NULL
        AND so.deleted_at IS NULL
        AND sol.status = 'open'
        ${fromFrag}
        ${toFrag}
        ${typeFrag}
      ORDER BY sol.due_date ASC NULLS LAST, so.code, sol.line_no
      LIMIT 1000
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      so_code: String(r['so_code'] ?? ''),
      so_date:
        r['so_date'] instanceof Date
          ? r['so_date'].toISOString().slice(0, 10)
          : String(r['so_date'] ?? ''),
      client_name: String(r['client_name'] ?? ''),
      so_type: String(r['so_type'] ?? ''),
      line_no: r['line_no'] != null ? Number(r['line_no']) : 0,
      item_code: String(r['item_code'] ?? ''),
      item_name: String(r['item_name'] ?? ''),
      order_qty: Number(r['order_qty'] ?? 0),
      completed_qty: Number(r['completed_qty'] ?? 0),
      pending_qty: Number(r['pending_qty'] ?? 0),
      line_value: Number(r['line_value'] ?? 0),
      due_date:
        r['due_date'] instanceof Date
          ? r['due_date'].toISOString().slice(0, 10)
          : r['due_date'] != null
            ? String(r['due_date'])
            : null,
    }));

    return { columns: soOpenBacklogReport.definition.columns, rows };
  },
};
