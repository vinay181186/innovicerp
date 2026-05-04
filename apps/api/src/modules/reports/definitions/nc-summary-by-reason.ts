// NC summary by reason — group nc_register by reason_category, count + sum
// of rejected_qty per group + count of "still pending" within each group.
// Pattern: aggregate query with GROUP BY + computed sub-counts. Optional
// date-range filter narrows the input set before aggregation.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';

export const ncSummaryByReasonReport: RegisteredReport = {
  definition: {
    slug: 'nc-summary-by-reason',
    title: 'NC summary by reason',
    description:
      'NCs grouped by reason category — total count, rejected qty sum, pending count. Useful for the QC review meeting.',
    group: 'Quality',
    filters: [
      { key: 'fromDate', label: 'From date', kind: 'date' },
      { key: 'toDate', label: 'To date', kind: 'date' },
    ],
    columns: [
      { key: 'reason_category', label: 'Reason', type: 'text' },
      { key: 'nc_count', label: 'NC count', type: 'number' },
      { key: 'pending_count', label: 'Still pending', type: 'number' },
      { key: 'total_rejected_qty', label: 'Rejected qty (total)', type: 'number' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const fromFrag = filters['fromDate']
      ? sql`AND nc.nc_date >= ${filters['fromDate']}::date`
      : sql``;
    const toFrag = filters['toDate'] ? sql`AND nc.nc_date <= ${filters['toDate']}::date` : sql``;

    const result = await tx.execute(sql`
      SELECT
        nc.reason_category,
        COUNT(*)::int AS nc_count,
        SUM(CASE WHEN nc.status = 'pending' THEN 1 ELSE 0 END)::int AS pending_count,
        COALESCE(SUM(nc.rejected_qty), 0)::float AS total_rejected_qty
      FROM public.nc_register nc
      WHERE nc.company_id = ${companyId}::uuid
        AND nc.deleted_at IS NULL
        ${fromFrag}
        ${toFrag}
      GROUP BY nc.reason_category
      ORDER BY nc_count DESC, nc.reason_category
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      reason_category: String(r['reason_category'] ?? ''),
      nc_count: Number(r['nc_count'] ?? 0),
      pending_count: Number(r['pending_count'] ?? 0),
      total_rejected_qty: Number(r['total_rejected_qty'] ?? 0),
    }));

    return { columns: ncSummaryByReasonReport.definition.columns, rows };
  },
};
