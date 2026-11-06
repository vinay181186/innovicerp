// NC by SO/JC — group nc_register by the order it belongs to (SO or JWSO),
// falling back to the job-card code, then the literal 'Unknown'. Mirrors legacy `_rptNC`
// second sub-table "NC by SO/JC" (HTML L20269–20280): columns
// SO/JC / Count / Rejected Qty / Pending / Closed.
//
// Legacy groups by `nc.soNo || nc.jcNo || 'Unknown'` and splits each group's
// count into Pending (status === 'Pending') vs Closed (everything else).
// We mirror that with the order code (ncOrderCodeSql, ADR-276) → job_cards.code
// → 'Unknown', and treat
// any non-'pending' status (disposed / rework_done / closed) as "closed".
//
// Deliberately carries NO Drawing Rev column. The grain here is one row per
// SO/JC *group*, and the group key is an order HEADER code —
// one header covers many SO lines, each of which may sit at a different
// customer drawing revision, so there is no single revision to print. Adding
// one would mean folding it into the group key, which splits each SO into one
// row per revision and silently changes the counts this report exists to
// give. The per-NC revision belongs on the line-level NC reports instead.

import { sql } from 'drizzle-orm';
import { ncOrderCodeSql, ncSoKeySql } from '../../nc-register/so-key';
import type { RegisteredReport } from '../registry';

export const ncBySoJcReport: RegisteredReport = {
  definition: {
    slug: 'nc-by-so-jc',
    title: 'NC by SO/JC',
    description:
      'NCs grouped by Sales Order or JWSO (falling back to Job Card) — count, deviated qty, pending vs closed. Pinpoints which orders are generating quality issues.',
    group: 'Quality',
    dept: 'qc',
    filters: [
      { key: 'fromDate', label: 'NC Date From', kind: 'date' },
      { key: 'toDate', label: 'NC Date To', kind: 'date' },
    ],
    columns: [
      { key: 'so_jc', label: 'SO No. / JWSO No.', type: 'text' },
      { key: 'so_internal_no', label: 'Internal SO No.', type: 'text' },
      { key: 'nc_count', label: 'NC Count', type: 'number' },
      { key: 'total_rejected_qty', label: 'Deviated', type: 'number' },
      { key: 'pending_count', label: 'Pending NCs', type: 'number' },
      { key: 'closed_count', label: 'Closed NCs', type: 'number' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const fromFrag = filters['fromDate']
      ? sql`AND nc.nc_date >= ${filters['fromDate']}::date`
      : sql``;
    const toFrag = filters['toDate'] ? sql`AND nc.nc_date <= ${filters['toDate']}::date` : sql``;

    const result = await tx.execute(sql`
      SELECT
        g.so_jc,
        -- ADR-207 — live Internal SO No. of the group's SO (blank for a JC group).
        MAX(g.so_internal_no) AS so_internal_no,
        COUNT(*)::int AS nc_count,
        COALESCE(SUM(nc.rejected_qty), 0)::float AS total_rejected_qty,
        SUM(CASE WHEN nc.status = 'pending' THEN 1 ELSE 0 END)::int AS pending_count,
        SUM(CASE WHEN nc.status <> 'pending' THEN 1 ELSE 0 END)::int AS closed_count
      FROM public.nc_register nc
      LEFT JOIN public.job_cards jc ON jc.id = nc.job_card_id
      -- ADR-276: the group key, computed once. A LATERAL with no FROM returns
      -- exactly one row per NC, so every SUM / COUNT above stays per NC.
      CROSS JOIN LATERAL (
        SELECT
          COALESCE(${ncOrderCodeSql('nc')}, jc.code, 'Unknown') AS so_jc,
          (SELECT nso.internal_so_no FROM public.sales_orders nso
            WHERE nso.id = ${ncSoKeySql('nc')}) AS so_internal_no
      ) g
      WHERE nc.company_id = ${companyId}::uuid
        AND nc.deleted_at IS NULL
        ${fromFrag}
        ${toFrag}
      GROUP BY g.so_jc
      ORDER BY nc_count DESC, g.so_jc
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      so_jc: String(r['so_jc'] ?? ''),
      so_internal_no: (r['so_internal_no'] as string | null) ?? null,
      nc_count: Number(r['nc_count'] ?? 0),
      total_rejected_qty: Number(r['total_rejected_qty'] ?? 0),
      pending_count: Number(r['pending_count'] ?? 0),
      closed_count: Number(r['closed_count'] ?? 0),
    }));

    return { columns: ncBySoJcReport.definition.columns, rows };
  },
};
