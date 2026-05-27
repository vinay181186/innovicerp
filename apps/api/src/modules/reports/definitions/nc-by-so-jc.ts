// NC by SO/JC — group nc_register by the SO it belongs to, falling back to
// the job-card code, then the literal 'Unknown'. Mirrors legacy `_rptNC`
// second sub-table "NC by SO/JC" (HTML L20269–20280): columns
// SO/JC / Count / Rejected Qty / Pending / Closed.
//
// Legacy groups by `nc.soNo || nc.jcNo || 'Unknown'` and splits each group's
// count into Pending (status === 'Pending') vs Closed (everything else).
// We mirror that with so_code_text → job_cards.code → 'Unknown', and treat
// any non-'pending' status (disposed / rework_done / closed) as "closed".

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';

export const ncBySoJcReport: RegisteredReport = {
  definition: {
    slug: 'nc-by-so-jc',
    title: 'NC by SO/JC',
    description:
      'NCs grouped by Sales Order (falling back to Job Card) — count, rejected qty, pending vs closed. Pinpoints which orders are generating quality issues.',
    group: 'Quality',
    filters: [
      { key: 'fromDate', label: 'From date', kind: 'date' },
      { key: 'toDate', label: 'To date', kind: 'date' },
    ],
    columns: [
      { key: 'so_jc', label: 'SO/JC', type: 'text' },
      { key: 'nc_count', label: 'Count', type: 'number' },
      { key: 'total_rejected_qty', label: 'Rejected Qty', type: 'number' },
      { key: 'pending_count', label: 'Pending', type: 'number' },
      { key: 'closed_count', label: 'Closed', type: 'number' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const fromFrag = filters['fromDate']
      ? sql`AND nc.nc_date >= ${filters['fromDate']}::date`
      : sql``;
    const toFrag = filters['toDate'] ? sql`AND nc.nc_date <= ${filters['toDate']}::date` : sql``;

    const result = await tx.execute(sql`
      SELECT
        COALESCE(NULLIF(nc.so_code_text, ''), jc.code, 'Unknown') AS so_jc,
        COUNT(*)::int AS nc_count,
        COALESCE(SUM(nc.rejected_qty), 0)::float AS total_rejected_qty,
        SUM(CASE WHEN nc.status = 'pending' THEN 1 ELSE 0 END)::int AS pending_count,
        SUM(CASE WHEN nc.status <> 'pending' THEN 1 ELSE 0 END)::int AS closed_count
      FROM public.nc_register nc
      LEFT JOIN public.job_cards jc ON jc.id = nc.job_card_id
      WHERE nc.company_id = ${companyId}::uuid
        AND nc.deleted_at IS NULL
        ${fromFrag}
        ${toFrag}
      GROUP BY COALESCE(NULLIF(nc.so_code_text, ''), jc.code, 'Unknown')
      ORDER BY nc_count DESC, so_jc
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      so_jc: String(r['so_jc'] ?? ''),
      nc_count: Number(r['nc_count'] ?? 0),
      total_rejected_qty: Number(r['total_rejected_qty'] ?? 0),
      pending_count: Number(r['pending_count'] ?? 0),
      closed_count: Number(r['closed_count'] ?? 0),
    }));

    return { columns: ncBySoJcReport.definition.columns, rows };
  },
};
