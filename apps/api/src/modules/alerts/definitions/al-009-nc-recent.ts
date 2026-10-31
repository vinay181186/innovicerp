// AL-009 — QC rejections in the last 3 days (qc). Legacy line 22273-22274.
// Filter: nc_date >= today - 3 days. Includes NCs in any status (it's a
// "what happened recently?" tripwire, not a backlog).

import { docNavPage } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { polSql } from '../../../lib/pol';
import type { RegisteredAlert } from '../registry';

export const al009NcRecent: RegisteredAlert = {
  definition: {
    code: 'AL-009',
    dept: 'qc',
    name: 'NCs Raised (Last 3 Days)',
    description: 'NCs filed within the last 3 days.',
    columns: [
      // ADR-261 lead columns: SO No. · Internal SO No. · POL · Created On ·
      // Item Code (CODE/REV) · Item Name, then the rest.
      { key: 'nc_code', label: 'NC No.', type: 'text' },
      { key: 'nc_date', label: 'NC Date', type: 'date' },
      { key: 'so_code', label: 'SO No.', type: 'text' },
      { key: 'so_internal_no', label: 'Internal SO No.', type: 'text' },
      { key: 'client_po_line_no', label: 'POL', type: 'text' },
      { key: 'created_on', label: 'Created On', type: 'date' },
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_name', label: 'Item Name', type: 'text' },
      { key: 'jc_code', label: 'JC No.', type: 'text' },
      { key: 'rejected_qty', label: 'Deviated', type: 'number' },
      { key: 'status', label: 'NC Status', type: 'text' },
    ],
    defaultActive: true,
  },
  async run({ tx, companyId }) {
    const result = await tx.execute(sql`
      SELECT nc.id AS nav_id,
             COALESCE(so.code, nc.so_code_text, jwo.code) AS so_code,
             so.internal_so_no AS so_internal_no,
             ${polSql('sol', 'jwl')} AS client_po_line_no,
             (nc.created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS created_on,
             (COALESCE(nc.item_code_text, '')
               || COALESCE('/' || NULLIF(btrim(COALESCE(sol.revision::text, jwl.revision::text)), ''), '')) AS item_code,
             COALESCE(i.name, nc.item_name_text) AS item_name,
             nc.code AS nc_code, nc.nc_date, jc.code AS jc_code,
             nc.rejected_qty, nc.status
      FROM public.nc_register nc
      LEFT JOIN public.job_cards jc ON jc.id = nc.job_card_id
      LEFT JOIN public.sales_orders so ON so.id = nc.so_id
      LEFT JOIN public.sales_order_lines sol ON sol.id = jc.source_so_line_id
      LEFT JOIN public.job_work_order_lines jwl ON jwl.id = jc.source_jw_line_id
      LEFT JOIN public.job_work_orders jwo ON jwo.id = jwl.job_work_order_id
      LEFT JOIN public.items i ON i.id = nc.item_id
      WHERE nc.company_id = ${companyId}::uuid
        AND nc.deleted_at IS NULL
        AND nc.nc_date >= CURRENT_DATE - INTERVAL '3 days'
      ORDER BY nc.nc_date DESC, nc.code
    `);
    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      navPage: docNavPage('nc', String(r['nav_id'])),
      so_code: (r['so_code'] as string | null) ?? '',
      so_internal_no: (r['so_internal_no'] as string | null) ?? '',
      client_po_line_no: (r['client_po_line_no'] as string | null) ?? '',
      created_on: String(r['created_on'] ?? ''),
      item_code: (r['item_code'] as string | null) ?? '',
      item_name: (r['item_name'] as string | null) ?? '',
      nc_code: (r['nc_code'] as string) ?? '',
      nc_date:
        r['nc_date'] instanceof Date
          ? r['nc_date'].toISOString().slice(0, 10)
          : String(r['nc_date'] ?? ''),
      jc_code: (r['jc_code'] as string) ?? '',
      rejected_qty: r['rejected_qty'] != null ? Number(r['rejected_qty']) : 0,
      status: (r['status'] as string) ?? '',
    }));
    return { records: rows };
  },
};
