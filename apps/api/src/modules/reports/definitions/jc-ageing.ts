// Open JC ageing — JCs not yet closed/complete, with `days_open` computed
// from CURRENT_DATE - jc_date. Pattern: list with computed field +
// computed_status enum filter. Mirror of open-po-ageing for production.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';

export const jcAgeingReport: RegisteredReport = {
  definition: {
    slug: 'jc-ageing',
    title: 'JC ageing',
    description:
      'Open job cards (computed_status not closed/complete) sorted oldest-first to surface stuck production. `days_open` is CURRENT_DATE - jc_date.',
    group: 'Operations',
    filters: [
      {
        key: 'computedStatus',
        label: 'Status',
        kind: 'enum',
        options: ['open', 'qc_pending', 'no_ops'],
      },
    ],
    columns: [
      { key: 'jc_code', label: 'JC no.', type: 'text' },
      { key: 'jc_date', label: 'JC date', type: 'date' },
      { key: 'days_open', label: 'Days open', type: 'number' },
      { key: 'item_code', label: 'Item code', type: 'text' },
      // Customer drawing revision of the SO line this JC came from. Kept out
      // of item_code because the sheet is filtered and VLOOKUP'd on that
      // column. Blank for a JW-sourced or standalone JC — no SO line, no
      // customer revision.
      { key: 'so_revision', label: 'Drawing Rev', type: 'text' },
      { key: 'item_name', label: 'Item name', type: 'text' },
      { key: 'qty', label: 'Order qty', type: 'number' },
      { key: 'computed_status', label: 'Status', type: 'text' },
      { key: 'total_ops', label: 'Total ops', type: 'number' },
      { key: 'done_ops', label: 'Done ops', type: 'number' },
      { key: 'due_date', label: 'Due date', type: 'date' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const statusFilter = filters['computedStatus'];
    const validStatuses = ['open', 'qc_pending', 'no_ops'];
    const statusFrag =
      statusFilter && validStatuses.includes(statusFilter)
        ? sql`AND v.computed_status = ${statusFilter}`
        : sql`AND v.computed_status IN ('open', 'qc_pending', 'no_ops')`;

    const result = await tx.execute(sql`
      SELECT
        jc.code                          AS jc_code,
        jc.jc_date                       AS jc_date,
        (CURRENT_DATE - jc.jc_date)::int AS days_open,
        it.code                          AS item_code,
        -- ::text because production is still pre-0119 and stores an integer.
        sol.revision::text               AS so_revision,
        it.name                          AS item_name,
        jc.order_qty                     AS qty,
        v.computed_status                AS computed_status,
        v.total_ops                      AS total_ops,
        v.done_ops                       AS done_ops,
        jc.due_date                      AS due_date
      FROM public.job_cards jc
      JOIN public.items it ON it.id = jc.item_id
      LEFT JOIN public.v_jc_status v ON v.job_card_id = jc.id
      -- LEFT, never inner: a JC raised from a JW line or by hand has no source
      -- SO line, and this ageing list is how stuck production is spotted —
      -- silently dropping those rows would hide real work.
      LEFT JOIN public.sales_order_lines sol ON sol.id = jc.source_so_line_id
      WHERE jc.company_id = ${companyId}::uuid
        AND jc.deleted_at IS NULL
        ${statusFrag}
      ORDER BY jc.jc_date ASC, jc.code
      LIMIT 1000
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      jc_code: String(r['jc_code'] ?? ''),
      jc_date:
        r['jc_date'] instanceof Date
          ? r['jc_date'].toISOString().slice(0, 10)
          : String(r['jc_date'] ?? ''),
      days_open: r['days_open'] != null ? Number(r['days_open']) : 0,
      item_code: String(r['item_code'] ?? ''),
      // '' not '—': a JC with no SO line must leave the cell blank so nobody
      // ends up sorting a column of dashes.
      so_revision: String(r['so_revision'] ?? ''),
      item_name: String(r['item_name'] ?? ''),
      qty: Number(r['qty'] ?? 0),
      computed_status: String(r['computed_status'] ?? ''),
      total_ops: r['total_ops'] != null ? Number(r['total_ops']) : 0,
      done_ops: r['done_ops'] != null ? Number(r['done_ops']) : 0,
      due_date:
        r['due_date'] instanceof Date
          ? r['due_date'].toISOString().slice(0, 10)
          : r['due_date'] != null
            ? String(r['due_date'])
            : null,
    }));

    return { columns: jcAgeingReport.definition.columns, rows };
  },
};
