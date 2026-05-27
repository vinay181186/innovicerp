// NC summary by reason — group nc_register by reason_category, with a
// per-disposition breakdown (Rework / Scrap / Use As Is / RTV / Make Fresh)
// and a TOTAL row appended last. Mirrors legacy `_rptNC` first sub-table
// "NC Register - Disposition by Reason" (HTML L20254–20279, _rptTbl totals
// L20107). Optional date-range filter narrows the input set before aggregation.
//
// The reports engine has no dedicated totals channel (see report.ts), so the
// TOTAL row is emitted as the final data row — exactly how legacy `_rptTbl`
// appends its totals <tr>. The first column carries the literal 'TOTAL'.

import { sql } from 'drizzle-orm';
import type { ReportRow } from '../schema';
import type { RegisteredReport } from '../registry';

export const ncSummaryByReasonReport: RegisteredReport = {
  definition: {
    slug: 'nc-summary-by-reason',
    title: 'NC Register - Disposition by Reason',
    description:
      'NCs grouped by reason category — count, rejected qty, and a per-disposition breakdown (Rework / Scrap / Use As Is / RTV / Make Fresh) with a TOTAL row. Useful for the QC review meeting.',
    group: 'Quality',
    filters: [
      { key: 'fromDate', label: 'From date', kind: 'date' },
      { key: 'toDate', label: 'To date', kind: 'date' },
    ],
    columns: [
      { key: 'reason_category', label: 'Reason', type: 'text' },
      { key: 'nc_count', label: 'Count', type: 'number' },
      { key: 'total_rejected_qty', label: 'Qty', type: 'number' },
      { key: 'rework_count', label: 'Rework', type: 'number' },
      { key: 'scrap_count', label: 'Scrap', type: 'number' },
      { key: 'use_as_is_count', label: 'Use As Is', type: 'number' },
      { key: 'rtv_count', label: 'RTV', type: 'number' },
      { key: 'make_fresh_count', label: 'Make Fresh', type: 'number' },
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
        COALESCE(SUM(nc.rejected_qty), 0)::float AS total_rejected_qty,
        SUM(CASE WHEN nc.disposition = 'rework' THEN 1 ELSE 0 END)::int AS rework_count,
        SUM(CASE WHEN nc.disposition = 'scrap' THEN 1 ELSE 0 END)::int AS scrap_count,
        SUM(CASE WHEN nc.disposition = 'use_as_is' THEN 1 ELSE 0 END)::int AS use_as_is_count,
        SUM(CASE WHEN nc.disposition = 'return_to_vendor' THEN 1 ELSE 0 END)::int AS rtv_count,
        SUM(CASE WHEN nc.disposition = 'make_fresh' THEN 1 ELSE 0 END)::int AS make_fresh_count
      FROM public.nc_register nc
      WHERE nc.company_id = ${companyId}::uuid
        AND nc.deleted_at IS NULL
        ${fromFrag}
        ${toFrag}
      GROUP BY nc.reason_category
      ORDER BY nc_count DESC, nc.reason_category
    `);

    const rows: ReportRow[] = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      reason_category: String(r['reason_category'] ?? ''),
      nc_count: Number(r['nc_count'] ?? 0),
      total_rejected_qty: Number(r['total_rejected_qty'] ?? 0),
      rework_count: Number(r['rework_count'] ?? 0),
      scrap_count: Number(r['scrap_count'] ?? 0),
      use_as_is_count: Number(r['use_as_is_count'] ?? 0),
      rtv_count: Number(r['rtv_count'] ?? 0),
      make_fresh_count: Number(r['make_fresh_count'] ?? 0),
    }));

    // TOTAL row — legacy `_rptTbl` appends a totals <tr> after the data
    // (HTML L20107, t2 built at L20267). Skip when there are no data rows.
    if (rows.length > 0) {
      const total: ReportRow = {
        reason_category: 'TOTAL',
        nc_count: 0,
        total_rejected_qty: 0,
        rework_count: 0,
        scrap_count: 0,
        use_as_is_count: 0,
        rtv_count: 0,
        make_fresh_count: 0,
      };
      for (const row of rows) {
        total['nc_count'] = Number(total['nc_count']) + Number(row['nc_count']);
        total['total_rejected_qty'] =
          Number(total['total_rejected_qty']) + Number(row['total_rejected_qty']);
        total['rework_count'] = Number(total['rework_count']) + Number(row['rework_count']);
        total['scrap_count'] = Number(total['scrap_count']) + Number(row['scrap_count']);
        total['use_as_is_count'] =
          Number(total['use_as_is_count']) + Number(row['use_as_is_count']);
        total['rtv_count'] = Number(total['rtv_count']) + Number(row['rtv_count']);
        total['make_fresh_count'] =
          Number(total['make_fresh_count']) + Number(row['make_fresh_count']);
      }
      rows.push(total);
    }

    return { columns: ncSummaryByReasonReport.definition.columns, rows };
  },
};
