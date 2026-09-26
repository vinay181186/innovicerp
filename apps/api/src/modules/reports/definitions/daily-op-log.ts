// Daily op-log report — flat list of op_log rows in a date range, with
// resolved jc code, op_seq, operation, operator name. Pattern: simple list
// with date-range filter.

import { opSrNo } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';

export const dailyOpLogReport: RegisteredReport = {
  definition: {
    slug: 'daily-op-log',
    title: 'Daily op log',
    description:
      'Time-stamped completion records by JC + op + operator over a date range. Mirrors the legacy op-log audit view.',
    group: 'Production',
    dept: 'production',
    filters: [
      { key: 'fromDate', label: 'Log Date From', kind: 'date' },
      { key: 'toDate', label: 'Log Date To', kind: 'date' },
    ],
    columns: [
      { key: 'log_date', label: 'Log Date', type: 'date' },
      { key: 'log_no', label: 'Log No.', type: 'text' },
      { key: 'log_type', label: 'Log Type', type: 'text' },
      { key: 'jc_code', label: 'JC No.', type: 'text' },
      // This report has no item-code column, so the revision sits immediately
      // after the JC — the column that identifies what was worked on. It is
      // the customer drawing revision of the SO line behind that JC, and is
      // blank for a JW-sourced or standalone JC.
      { key: 'so_revision', label: 'Drawing Rev', type: 'text' },
      { key: 'op_seq', label: 'Op', type: 'number' },
      { key: 'operation', label: 'Operation', type: 'text' },
      { key: 'operator_name', label: 'Operator', type: 'text' },
      { key: 'qty', label: 'Completed', type: 'number' },
      { key: 'reject_qty', label: 'Rejected', type: 'number' },
      { key: 'shift', label: 'Shift', type: 'text' },
    ],
    // ADR-190 — jc_code opens the document; jc_id is not a column.
    rowLink: { column: 'jc_code', route: '/job-cards/$id', idKey: 'jc_id' },
  },
  async run({ tx, companyId, filters }) {
    const fromFrag = filters['fromDate']
      ? sql`AND ol.log_date >= ${filters['fromDate']}::date`
      : sql``;
    const toFrag = filters['toDate'] ? sql`AND ol.log_date <= ${filters['toDate']}::date` : sql``;

    const result = await tx.execute(sql`
      SELECT
        jc.id AS jc_id,
        ol.log_date,
        ol.log_no,
        ol.log_type,
        jc.code AS jc_code,
        -- ::text because production is still pre-0119 and holds an integer.
        sol.revision::text AS so_revision,
        jo.op_seq,
        jo.operation,
        ol.operator_name,
        ol.qty,
        ol.reject_qty,
        ol.shift
      FROM public.op_log ol
      JOIN public.jc_ops jo ON jo.id = ol.jc_op_id
      JOIN public.job_cards jc ON jc.id = jo.job_card_id
      -- LEFT, never inner: work logged against a JW-sourced or standalone JC
      -- has no SO line behind it, and this is the shop-floor audit trail —
      -- every logged op has to stay visible.
      LEFT JOIN public.sales_order_lines sol ON sol.id = jc.source_so_line_id
      WHERE ol.company_id = ${companyId}::uuid
        ${fromFrag}
        ${toFrag}
      ORDER BY ol.log_date DESC, ol.log_no DESC
      LIMIT 1000
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      jc_id: String(r['jc_id'] ?? ''),
      log_date:
        r['log_date'] instanceof Date
          ? r['log_date'].toISOString().slice(0, 10)
          : String(r['log_date']),
      log_no: (r['log_no'] as string) ?? '',
      log_type: (r['log_type'] as string) ?? '',
      jc_code: (r['jc_code'] as string) ?? '',
      so_revision: (r['so_revision'] as string | null) ?? '',
      // display rule — see opSrNo in @innovic/shared
      op_seq: r['op_seq'] != null ? opSrNo(Number(r['op_seq'])) : 0,
      operation: (r['operation'] as string) ?? '',
      operator_name: (r['operator_name'] as string | null) ?? null,
      qty: r['qty'] != null ? Number(r['qty']) : 0,
      reject_qty: r['reject_qty'] != null ? Number(r['reject_qty']) : 0,
      shift: (r['shift'] as string) ?? '',
    }));

    return { columns: dailyOpLogReport.definition.columns, rows };
  },
};
