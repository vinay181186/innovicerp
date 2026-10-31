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
// Closed Date = nc_register.closed_at (IST date); an NC closed before closed_at
// existed falls back to its disposition_date. An NC that is not closed shows
// no Closed Date (before, every disposed NC showed its disposition date).

import { NC_FILTER_STATUSES } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { polSql } from '../../../lib/pol';
import type { RegisteredReport } from '../registry';
import { REPORT_ROW_CAP } from './report-helpers';

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
    dept: 'qc',
    filters: [
      { key: 'fromDate', label: 'NC Date From', kind: 'date' },
      { key: 'toDate', label: 'NC Date To', kind: 'date' },
      {
        key: 'status',
        label: 'NC Status',
        kind: 'enum',
        // S8 — every status NCs are written in (rework_done is legacy, hidden).
        options: [...NC_FILTER_STATUSES],
      },
    ],
    columns: [
      // ADR-261 lead columns. SO No. = the NC's SO (live, else snapshot),
      // else the JWSO of its Job Card; POL and the drawing rev (in Item Code)
      // come from the JC's order line. Created On = the NC's created_at.
      { key: 'so_code', label: 'SO No.', type: 'text' },
      { key: 'so_internal_no', label: 'Internal SO No.', type: 'text' },
      { key: 'client_po_line_no', label: 'POL', type: 'text' },
      { key: 'created_on', label: 'Created On', type: 'date' },
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_name', label: 'Item Name', type: 'text' },
      { key: 'nc_no', label: 'NC No.', type: 'text' },
      { key: 'nc_date', label: 'NC Date', type: 'date' },
      { key: 'jc_code', label: 'JC No.', type: 'text' },
      { key: 'operation', label: 'Operation', type: 'text' },
      { key: 'rejected_qty', label: 'Deviated', type: 'number' },
      { key: 'reason_category', label: 'Reason', type: 'text' },
      { key: 'details', label: 'Details', type: 'text' },
      { key: 'disposition', label: 'Disposition', type: 'text' },
      { key: 'status', label: 'NC Status', type: 'text' },
      { key: 'closed_date', label: 'Closed Date', type: 'date' },
    ],
    // ADR-190 — nc_no opens the document; nc_id is not a column.
    rowLink: { column: 'nc_no', route: '/nc-register/$id', idKey: 'nc_id' },
  },
  async run({ tx, companyId, filters }) {
    const fromFrag = filters['fromDate']
      ? sql`AND nc.nc_date >= ${filters['fromDate']}::date`
      : sql``;
    const toFrag = filters['toDate'] ? sql`AND nc.nc_date <= ${filters['toDate']}::date` : sql``;
    const status = filters['status'];
    const validStatus: readonly string[] = NC_FILTER_STATUSES;
    const statusFrag =
      status && validStatus.includes(status) ? sql`AND nc.status = ${status}::nc_status` : sql``;

    const result = await tx.execute(sql`
      SELECT
        nc.id AS nc_id,
        nc.code                              AS nc_no,
        nc.nc_date                           AS nc_date,
        jc.code                              AS jc_code,
        -- 0184: the live SO code, else the typed snapshot.
        COALESCE(so.code, nc.so_code_text, jwo.code) AS so_code,
        so.internal_so_no                    AS so_internal_no,
        ${polSql('sol', 'jwl')}              AS client_po_line_no,
        (nc.created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS created_on,
        (nc.item_code_text
          || COALESCE('/' || NULLIF(btrim(COALESCE(sol.revision::text, jwl.revision::text)), ''), '')) AS item_code,
        COALESCE(it.name, nc.item_name_text) AS item_name,
        nc.operation_text                    AS operation,
        nc.rejected_qty                      AS rejected_qty,
        nc.reason_category::text             AS reason_category,
        nc.reason                            AS details,
        nc.disposition::text                 AS disposition,
        nc.status::text                      AS status,
        -- The real close date (IST); older closed rows have no closed_at.
        COALESCE(
          (nc.closed_at AT TIME ZONE 'Asia/Kolkata')::date,
          CASE WHEN nc.status = 'closed' THEN nc.disposition_date END
        )                                    AS closed_date
      FROM public.nc_register nc
      LEFT JOIN public.job_cards jc ON jc.id = nc.job_card_id
      LEFT JOIN public.sales_orders so ON so.id = nc.so_id
      LEFT JOIN public.sales_order_lines sol ON sol.id = jc.source_so_line_id
      LEFT JOIN public.job_work_order_lines jwl ON jwl.id = jc.source_jw_line_id
      LEFT JOIN public.job_work_orders jwo ON jwo.id = jwl.job_work_order_id
      LEFT JOIN public.items it ON it.id = nc.item_id
      WHERE nc.company_id = ${companyId}::uuid
        AND nc.deleted_at IS NULL
        ${fromFrag}
        ${toFrag}
        ${statusFrag}
      ORDER BY nc.nc_date DESC, nc.code DESC
      LIMIT ${REPORT_ROW_CAP}
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      nc_id: String(r['nc_id'] ?? ''),
      so_code: (r['so_code'] as string | null) ?? null,
      so_internal_no: (r['so_internal_no'] as string | null) ?? null,
      client_po_line_no: (r['client_po_line_no'] as string | null) ?? null,
      created_on: toDateString(r['created_on']),
      item_code: (r['item_code'] as string | null) ?? null,
      item_name: (r['item_name'] as string | null) ?? null,
      nc_no: String(r['nc_no'] ?? ''),
      nc_date: toDateString(r['nc_date']),
      jc_code: (r['jc_code'] as string | null) ?? null,
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
