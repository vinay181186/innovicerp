// Open JC ageing — JCs not yet closed/complete, with `days_open` computed
// from CURRENT_DATE - jc_date. Pattern: list with computed field +
// computed_status enum filter. Mirror of open-po-ageing for production.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import { polSql } from '../../../lib/pol';
import { dateCell, REPORT_ROW_CAP, textCell } from './report-helpers';

export const jcAgeingReport: RegisteredReport = {
  definition: {
    slug: 'jc-ageing',
    title: 'JC ageing',
    description:
      'Open Job Cards (not yet Completed or Closed) sorted oldest-first to surface stuck production. Days Open is today minus the JC Date.',
    group: 'Production',
    dept: 'production',
    filters: [
      {
        key: 'computedStatus',
        label: 'JC Status',
        kind: 'enum',
        options: ['open', 'qc_pending', 'no_ops'],
      },
    ],
    columns: [
      // ADR-261 lead columns. SO No. = the SO or JWSO the JC came from
      // (blank for a standalone JC); Created On = the JC's created_at; the
      // customer drawing rev rides in Item Code as CODE/REV.
      { key: 'so_code', label: 'SO No.', type: 'text' },
      { key: 'so_internal_no', label: 'Internal SO No.', type: 'text' },
      { key: 'client_po_line_no', label: 'POL', type: 'text' },
      { key: 'created_on', label: 'Created On', type: 'date' },
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_name', label: 'Item Name', type: 'text' },
      { key: 'jc_code', label: 'JC No.', type: 'text' },
      { key: 'jc_date', label: 'JC Date', type: 'date' },
      { key: 'days_open', label: 'Days Open', type: 'number' },
      { key: 'qty', label: 'Order Qty', type: 'number' },
      { key: 'computed_status', label: 'JC Status', type: 'text' },
      { key: 'total_ops', label: 'Total Ops', type: 'number' },
      { key: 'done_ops', label: 'Done Ops', type: 'number' },
      { key: 'due_date', label: 'Due Date', type: 'date' },
    ],
    // ADR-190 — jc_code opens the document; jc_id is not a column.
    rowLink: { column: 'jc_code', route: '/job-cards/$id', idKey: 'jc_id' },
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
        jc.id AS jc_id,
        jc.code                          AS jc_code,
        jc.jc_date                       AS jc_date,
        (CURRENT_DATE - jc.jc_date)::int AS days_open,
        COALESCE(so.code, jwo.code)      AS so_code,
        so.internal_so_no                AS so_internal_no,
        ${polSql('sol', 'jwl')}          AS client_po_line_no,
        (jc.created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS created_on,
        -- CODE/REV: the customer's drawing rev (SO line, else JW line).
        (it.code || COALESCE('/' || NULLIF(btrim(COALESCE(sol.revision::text, jwl.revision::text)), ''), '')) AS item_code,
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
      LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id
      LEFT JOIN public.job_work_order_lines jwl ON jwl.id = jc.source_jw_line_id
      LEFT JOIN public.job_work_orders jwo ON jwo.id = jwl.job_work_order_id
      WHERE jc.company_id = ${companyId}::uuid
        AND jc.deleted_at IS NULL
        ${statusFrag}
      ORDER BY jc.jc_date ASC, jc.code
      LIMIT ${REPORT_ROW_CAP}
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      jc_id: String(r['jc_id'] ?? ''),
      so_code: textCell(r['so_code']),
      so_internal_no: textCell(r['so_internal_no']),
      client_po_line_no: textCell(r['client_po_line_no']),
      created_on: dateCell(r['created_on']),
      jc_code: String(r['jc_code'] ?? ''),
      jc_date:
        r['jc_date'] instanceof Date
          ? r['jc_date'].toISOString().slice(0, 10)
          : String(r['jc_date'] ?? ''),
      days_open: r['days_open'] != null ? Number(r['days_open']) : 0,
      item_code: String(r['item_code'] ?? ''),
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
