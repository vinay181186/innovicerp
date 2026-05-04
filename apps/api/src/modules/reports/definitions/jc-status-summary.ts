// Job-card status summary — pivot count of job_cards by computed_status
// from v_jc_status, joined back to items for breakdown by item code. Pattern:
// derived-view aggregate with a JOIN to a master table. No filters; the
// view is small enough to scan unconditionally.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';

export const jcStatusSummaryReport: RegisteredReport = {
  definition: {
    slug: 'jc-status-summary',
    title: 'Job-card status summary',
    description:
      'Open job cards grouped by computed status (from v_jc_status) with per-item breakdown. Surfaces stuck JCs at a glance.',
    group: 'Operations',
    filters: [],
    columns: [
      { key: 'computed_status', label: 'Status', type: 'text' },
      { key: 'item_code', label: 'Item code', type: 'text' },
      { key: 'item_name', label: 'Item name', type: 'text' },
      { key: 'jc_count', label: 'JC count', type: 'number' },
      { key: 'total_order_qty', label: 'Order qty (total)', type: 'number' },
      { key: 'done_ops_total', label: 'Done ops', type: 'number' },
      { key: 'qc_pending_ops_total', label: 'QC pending ops', type: 'number' },
    ],
  },
  async run({ tx, companyId }) {
    const result = await tx.execute(sql`
      SELECT
        v.computed_status,
        i.code AS item_code,
        i.name AS item_name,
        COUNT(*)::int AS jc_count,
        COALESCE(SUM(jc.order_qty), 0)::int AS total_order_qty,
        COALESCE(SUM(v.done_ops), 0)::int AS done_ops_total,
        COALESCE(SUM(v.qc_pending_ops), 0)::int AS qc_pending_ops_total
      FROM public.v_jc_status v
      JOIN public.job_cards jc ON jc.id = v.job_card_id
      LEFT JOIN public.items i ON i.id = jc.item_id AND i.deleted_at IS NULL
      WHERE v.company_id = ${companyId}::uuid
      GROUP BY v.computed_status, i.code, i.name
      ORDER BY
        CASE v.computed_status
          WHEN 'qc_pending' THEN 1
          WHEN 'open' THEN 2
          WHEN 'no_ops' THEN 3
          WHEN 'complete' THEN 4
          WHEN 'closed' THEN 5
          ELSE 99
        END,
        i.code
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      computed_status: String(r['computed_status'] ?? ''),
      item_code: (r['item_code'] as string | null) ?? null,
      item_name: (r['item_name'] as string | null) ?? null,
      jc_count: Number(r['jc_count'] ?? 0),
      total_order_qty: Number(r['total_order_qty'] ?? 0),
      done_ops_total: Number(r['done_ops_total'] ?? 0),
      qc_pending_ops_total: Number(r['qc_pending_ops_total'] ?? 0),
    }));

    return { columns: jcStatusSummaryReport.definition.columns, rows };
  },
};
