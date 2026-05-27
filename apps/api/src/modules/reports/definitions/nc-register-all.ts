// NC Register (All Records) — flat list of every non-conformance, newest
// first. Mirrors legacy `_rptNC` third sub-table "NC Register (All Records)"
// (HTML L20250–20251, L20281): columns
//   NC No / Date / JC / SO / Item / Operation / Qty / Reason / Details /
//   Disposition / Status / Closed.
//
// Legacy row shape (L20251):
//   [ncNo, date, jcNo, soNo, itemCode, operation, rejectedQty,
//    reasonCategory, reason, disposition, status, closedDate]
//
// Data note: legacy `nc.closedDate` has no dedicated column in nc_register.
// The closest equivalent is `disposition_date` (set when QC disposes the NC),
// which is what populates the "Closed" column here.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';

function toDateString(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v == null || v === '') return null;
  return String(v);
}

export const ncRegisterAllReport: RegisteredReport = {
  definition: {
    slug: 'nc-register-all',
    title: 'NC Register (All Records)',
    description:
      'Flat list of every non-conformance — one row per NC, newest first. The full QC register for audit and drill-down.',
    group: 'Quality',
    filters: [
      { key: 'fromDate', label: 'From date', kind: 'date' },
      { key: 'toDate', label: 'To date', kind: 'date' },
      {
        key: 'status',
        label: 'Status',
        kind: 'enum',
        options: ['pending', 'disposed', 'rework_done', 'closed'],
      },
    ],
    columns: [
      { key: 'nc_no', label: 'NC No', type: 'text' },
      { key: 'nc_date', label: 'Date', type: 'date' },
      { key: 'jc_code', label: 'JC', type: 'text' },
      { key: 'so_code', label: 'SO', type: 'text' },
      { key: 'item_code', label: 'Item', type: 'text' },
      { key: 'operation', label: 'Operation', type: 'text' },
      { key: 'rejected_qty', label: 'Qty', type: 'number' },
      { key: 'reason_category', label: 'Reason', type: 'text' },
      { key: 'details', label: 'Details', type: 'text' },
      { key: 'disposition', label: 'Disposition', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'closed_date', label: 'Closed', type: 'date' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const fromFrag = filters['fromDate']
      ? sql`AND nc.nc_date >= ${filters['fromDate']}::date`
      : sql``;
    const toFrag = filters['toDate'] ? sql`AND nc.nc_date <= ${filters['toDate']}::date` : sql``;
    const status = filters['status'];
    const validStatus = ['pending', 'disposed', 'rework_done', 'closed'];
    const statusFrag =
      status && validStatus.includes(status)
        ? sql`AND nc.status = ${status}::nc_status`
        : sql``;

    const result = await tx.execute(sql`
      SELECT
        nc.code                              AS nc_no,
        nc.nc_date                           AS nc_date,
        jc.code                              AS jc_code,
        nc.so_code_text                      AS so_code,
        nc.item_code_text                    AS item_code,
        nc.operation_text                    AS operation,
        nc.rejected_qty                      AS rejected_qty,
        nc.reason_category::text             AS reason_category,
        nc.reason                            AS details,
        nc.disposition::text                 AS disposition,
        nc.status::text                      AS status,
        nc.disposition_date                  AS closed_date
      FROM public.nc_register nc
      LEFT JOIN public.job_cards jc ON jc.id = nc.job_card_id
      WHERE nc.company_id = ${companyId}::uuid
        AND nc.deleted_at IS NULL
        ${fromFrag}
        ${toFrag}
        ${statusFrag}
      ORDER BY nc.nc_date DESC, nc.code DESC
      LIMIT 1000
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      nc_no: String(r['nc_no'] ?? ''),
      nc_date: toDateString(r['nc_date']),
      jc_code: (r['jc_code'] as string | null) ?? null,
      so_code: (r['so_code'] as string | null) ?? null,
      item_code: (r['item_code'] as string | null) ?? null,
      operation: (r['operation'] as string | null) ?? null,
      rejected_qty: Number(r['rejected_qty'] ?? 0),
      reason_category: (r['reason_category'] as string | null) ?? null,
      details: (r['details'] as string | null) ?? null,
      disposition: (r['disposition'] as string | null) ?? null,
      status: String(r['status'] ?? ''),
      closed_date: toDateString(r['closed_date']),
    }));

    return { columns: ncRegisterAllReport.definition.columns, rows };
  },
};
