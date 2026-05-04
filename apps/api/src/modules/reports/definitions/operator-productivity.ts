// Operator productivity — total qty + log count + reject% per operator
// over a date range. Pattern: aggregate against op_log GROUP BY operator,
// with a computed reject-rate column. Operator name is preferred over the
// resolved operator_id since that's the durable text snapshot.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';

export const operatorProductivityReport: RegisteredReport = {
  definition: {
    slug: 'operator-productivity',
    title: 'Operator productivity',
    description:
      'Per-operator total qty + log count + reject rate over a date range. Aggregates op_log; operators with zero logs in the window do not appear.',
    group: 'Operations',
    filters: [
      { key: 'fromDate', label: 'From date', kind: 'date' },
      { key: 'toDate', label: 'To date', kind: 'date' },
    ],
    columns: [
      { key: 'operator_name', label: 'Operator', type: 'text' },
      { key: 'log_count', label: 'Logs', type: 'number' },
      { key: 'total_qty', label: 'Total qty', type: 'number' },
      { key: 'total_reject_qty', label: 'Reject qty', type: 'number' },
      { key: 'reject_pct', label: 'Reject %', type: 'number' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const fromFrag = filters['fromDate']
      ? sql`AND ol.log_date >= ${filters['fromDate']}::date`
      : sql``;
    const toFrag = filters['toDate'] ? sql`AND ol.log_date <= ${filters['toDate']}::date` : sql``;

    const result = await tx.execute(sql`
      SELECT
        COALESCE(NULLIF(ol.operator_name, ''), '(unattributed)') AS operator_name,
        COUNT(*)::int AS log_count,
        COALESCE(SUM(ol.qty), 0)::int AS total_qty,
        COALESCE(SUM(ol.reject_qty), 0)::int AS total_reject_qty,
        CASE
          WHEN COALESCE(SUM(ol.qty + ol.reject_qty), 0) = 0 THEN 0
          ELSE ROUND(
            100.0 * SUM(ol.reject_qty)::numeric
                  / NULLIF(SUM(ol.qty + ol.reject_qty), 0),
            2
          )
        END::float AS reject_pct
      FROM public.op_log ol
      WHERE ol.company_id = ${companyId}::uuid
        ${fromFrag}
        ${toFrag}
      GROUP BY COALESCE(NULLIF(ol.operator_name, ''), '(unattributed)')
      ORDER BY total_qty DESC, operator_name
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      operator_name: String(r['operator_name'] ?? ''),
      log_count: Number(r['log_count'] ?? 0),
      total_qty: Number(r['total_qty'] ?? 0),
      total_reject_qty: Number(r['total_reject_qty'] ?? 0),
      reject_pct: Number(r['reject_pct'] ?? 0),
    }));

    return { columns: operatorProductivityReport.definition.columns, rows };
  },
};
