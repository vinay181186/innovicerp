// Daily op-log report — flat list of op_log rows in a date range, with
// resolved jc code, op_seq, operation, operator name. Pattern: simple list
// with date-range filter.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';

export const dailyOpLogReport: RegisteredReport = {
  definition: {
    slug: 'daily-op-log',
    title: 'Daily op log',
    description:
      'Time-stamped completion records by JC + op + operator over a date range. Mirrors the legacy op-log audit view.',
    group: 'Operations',
    filters: [
      { key: 'fromDate', label: 'From date', kind: 'date' },
      { key: 'toDate', label: 'To date', kind: 'date' },
    ],
    columns: [
      { key: 'log_date', label: 'Date', type: 'date' },
      { key: 'log_no', label: 'Log no.', type: 'text' },
      { key: 'log_type', label: 'Type', type: 'text' },
      { key: 'jc_code', label: 'JC', type: 'text' },
      { key: 'op_seq', label: 'Op seq', type: 'number' },
      { key: 'operation', label: 'Operation', type: 'text' },
      { key: 'operator_name', label: 'Operator', type: 'text' },
      { key: 'qty', label: 'Qty', type: 'number' },
      { key: 'reject_qty', label: 'Reject qty', type: 'number' },
      { key: 'shift', label: 'Shift', type: 'text' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const fromFrag = filters['fromDate']
      ? sql`AND ol.log_date >= ${filters['fromDate']}::date`
      : sql``;
    const toFrag = filters['toDate'] ? sql`AND ol.log_date <= ${filters['toDate']}::date` : sql``;

    const result = await tx.execute(sql`
      SELECT
        ol.log_date,
        ol.log_no,
        ol.log_type,
        jc.code AS jc_code,
        jo.op_seq,
        jo.operation,
        ol.operator_name,
        ol.qty,
        ol.reject_qty,
        ol.shift
      FROM public.op_log ol
      JOIN public.jc_ops jo ON jo.id = ol.jc_op_id
      JOIN public.job_cards jc ON jc.id = jo.job_card_id
      WHERE ol.company_id = ${companyId}::uuid
        ${fromFrag}
        ${toFrag}
      ORDER BY ol.log_date DESC, ol.log_no DESC
      LIMIT 1000
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      log_date:
        r['log_date'] instanceof Date
          ? r['log_date'].toISOString().slice(0, 10)
          : String(r['log_date']),
      log_no: (r['log_no'] as string) ?? '',
      log_type: (r['log_type'] as string) ?? '',
      jc_code: (r['jc_code'] as string) ?? '',
      op_seq: r['op_seq'] != null ? Number(r['op_seq']) : 0,
      operation: (r['operation'] as string) ?? '',
      operator_name: (r['operator_name'] as string | null) ?? null,
      qty: r['qty'] != null ? Number(r['qty']) : 0,
      reject_qty: r['reject_qty'] != null ? Number(r['reject_qty']) : 0,
      shift: (r['shift'] as string) ?? '',
    }));

    return { columns: dailyOpLogReport.definition.columns, rows };
  },
};
